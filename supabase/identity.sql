-- ============================================================================
-- RandomChat: accounts, identity merge, Broadcast signaling, referrals v2,
-- provider-neutral payments, rate limits, bans          (supabase/identity.sql)
--
-- Run AFTER supabase/app.sql, in Supabase -> SQL Editor. Idempotent and
-- additive: no existing function signature is removed or changed, so the code
-- currently deployed keeps working while the new code rolls out.
-- ============================================================================

-- ── 1. New tables / columns ────────────────────────────────────────────────

-- Bans (written by moderators / service role). until = null means permanent.
create table if not exists public.bans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  reason      text not null,
  until       timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists bans_user_idx on public.bans (user_id);

-- Old invite codes keep crediting the account they were merged into.
create table if not exists public.referral_code_aliases (
  code        text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists referral_code_aliases_user_idx on public.referral_code_aliases (user_id);

-- Fixed-window counters for rate limits (sign-in codes, wrong codes, payment checks).
create table if not exists public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  count         integer not null default 0
);

-- Audit trail of anonymous -> account merges (for support questions).
create table if not exists public.identity_merges (
  id           bigint generated always as identity primary key,
  from_user    uuid not null,
  into_user    uuid not null,
  before_from  jsonb not null,
  before_into  jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists identity_merges_into_idx on public.identity_merges (into_user);

-- Matches: when media actually connected (referral rule: >= 60s chat).
alter table public.matches add column if not exists connected_at timestamptz;

-- Orders: which provider, the provider's transaction id, and the billing email we sent.
alter table public.orders add column if not exists provider        text not null default 'pesapal';
alter table public.orders add column if not exists provider_txn_id text;
alter table public.orders add column if not exists billing_email   text;
alter table public.orders add column if not exists billing_phone   text;
alter table public.orders drop constraint if exists orders_provider_check;
alter table public.orders add constraint orders_provider_check check (provider in ('pesapal', 'stripe', 'paypal'));
alter table public.orders drop constraint if exists orders_method_check;
alter table public.orders add constraint orders_method_check check (method in ('card', 'mpesa', 'paypal'));

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('pesapal', 'stripe', 'paypal', 'referral', 'mock'));

-- Keep orders and payments when an account is deleted (accounting): user_id becomes null.
do $$
declare c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = rel.oid and a.attnum = any (con.conkey)
     where n.nspname = 'public' and con.contype = 'f'
       and rel.relname in ('orders', 'payments') and a.attname = 'user_id'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end $$;
alter table public.orders   alter column user_id drop not null;
alter table public.payments alter column user_id drop not null;
alter table public.orders   add constraint orders_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;
alter table public.payments add constraint payments_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;

alter table public.bans                  enable row level security;
alter table public.referral_code_aliases enable row level security;
alter table public.rate_limits           enable row level security;
alter table public.identity_merges       enable row level security;
revoke all on public.bans, public.referral_code_aliases, public.rate_limits, public.identity_merges
  from anon, authenticated;

-- ── 2. Rate limits ─────────────────────────────────────────────────────────

-- Adds p_cost to the counter for p_key in the current window and returns whether the
-- total is still within p_max. p_cost = 0 just checks. Atomic under concurrency.
create or replace function public.rc_rate_hit(p_key text, p_max integer, p_window_s integer, p_cost integer default 1)
returns boolean language plpgsql as $$
declare v integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), p_cost)
  on conflict (key) do update
    set count = case when r.window_start < now() - make_interval(secs => p_window_s)
                     then p_cost else r.count + p_cost end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_s)
                            then now() else r.window_start end
  returning count into v;
  return v <= p_max;
end $$;

create or replace function public.rc_rate_reset(p_key text)
returns void language sql as $$
  delete from public.rate_limits where key = p_key;
$$;

-- ── 3. Profile + session check in one round trip ───────────────────────────

-- Like rc_get_profile, plus whether the session in the caller's JWT still exists
-- (it is gone after "Sign out of all devices" or account deletion).
create or replace function public.rc_load_user(p_user uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  insert into public.profiles (id)
  select id from auth.users where id = p_user
  on conflict (id) do nothing;
  select to_jsonb(p) into v from public.profiles p where p.id = p_user;
  if v is null then return null; end if;
  return v || jsonb_build_object(
    'session_ok', p_session is null or exists (select 1 from auth.sessions s where s.id = p_session and s.user_id = p_user),
    'banned', exists (select 1 from public.bans b where b.user_id = p_user and (b.until is null or b.until > now()))
  );
end $$;

-- Signed-in devices: device/browser come from the user agent. No IP is returned.
create or replace function public.rc_list_sessions(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'user_agent', s.user_agent,
           'created_at', s.created_at,
           'last_active', coalesce(s.refreshed_at, s.updated_at, s.created_at)
         ) order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc), '[]'::jsonb)
    from auth.sessions s
   where s.user_id = p_user;
$$;

-- ── 4. Referrals v2: credited after a >= 60s chat with someone else ─────────
-- Thresholds mirror REFERRAL in src/lib/plans.ts (tier1 10 -> +5, tier2 20 -> +10).

create or replace function public.rc_referral_codes_owner(p_code text)
returns uuid language sql stable as $$
  select coalesce(
    (select id from public.profiles where referral_code = p_code),
    (select user_id from public.referral_code_aliases where code = p_code));
$$;

create or replace function public.rc_referrer_exists(p_code text)
returns boolean language sql stable as $$
  select public.rc_referral_codes_owner(p_code) is not null;
$$;

create or replace function public.rc_set_referrer(p_user uuid, p_code text)
returns void language sql as $$
  update public.profiles
     set referred_by = public.rc_referral_codes_owner(p_code)
   where id = p_user and referred_by is null
     and created_at > now() - interval '10 minutes'
     and public.rc_referral_codes_owner(p_code) is distinct from p_user;
$$;

-- Recomputes a referrer's tier rewards from scratch-safe flags (each tier pays once).
create or replace function public.rc_apply_referral_tiers(p_referrer uuid)
returns void language plpgsql as $$
begin
  update public.profiles set tier1_awarded = true, bonus_matches = bonus_matches + 5
   where id = p_referrer and not tier1_awarded and referral_count >= 10;
  update public.profiles set tier2_awarded = true, bonus_matches = bonus_matches + 10
   where id = p_referrer and not tier2_awarded and referral_count >= 20;
end $$;

-- Credits p_user's referrer once, if p_user is age-verified and the chat partner was
-- not the referrer. Shared IPs don't matter any more.
create or replace function public.rc_credit_referral_after_chat(p_user uuid, p_partner uuid)
returns boolean language plpgsql as $$
declare u public.profiles%rowtype;
begin
  select * into u from public.profiles where id = p_user for update;
  if not found or u.referred_by is null or u.referral_credited or not u.age_verified
     or u.referred_by = p_partner then
    return false;
  end if;
  update public.profiles set referral_credited = true where id = p_user;
  update public.profiles set referral_count = referral_count + 1 where id = u.referred_by;
  perform public.rc_apply_referral_tiers(u.referred_by);
  return true;
end $$;

-- Client reports its media connected (first report wins).
create or replace function public.rc_mark_connected(p_match uuid, p_user uuid)
returns void language sql as $$
  update public.matches set connected_at = coalesce(connected_at, now())
   where id = p_match and ended_at is null and p_user in (user_a, user_b);
$$;

-- Ending a match now also settles referrals. Chat length runs from connected_at to the
-- last heartbeat of whichever side went quiet first (so a closed tab doesn't count the
-- 30s staleness wait).
create or replace function public.rc_end_match(p_match uuid)
returns void language plpgsql as $$
declare m public.matches; v_end timestamptz;
begin
  update public.matches set ended_at = now()
   where id = p_match and ended_at is null
  returning * into m;
  delete from public.signals where match_id = p_match;
  if m.id is null or m.connected_at is null then return; end if;
  v_end := least(now(), m.seen_a + interval '6 seconds', m.seen_b + interval '6 seconds');
  if v_end - m.connected_at >= interval '60 seconds' then
    perform public.rc_credit_referral_after_chat(m.user_a, m.user_b);
    perform public.rc_credit_referral_after_chat(m.user_b, m.user_a);
  end if;
end $$;

-- In-call heartbeat (replaces the signal drain): keeps the match alive, reports if it ended.
create or replace function public.rc_match_heartbeat(p_match uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare m public.matches; v_peer_seen timestamptz;
begin
  select * into m from public.matches
   where id = p_match and ended_at is null and p_user in (user_a, user_b);
  if not found then return jsonb_build_object('ended', true); end if;
  v_peer_seen := case when m.user_a = p_user then m.seen_b else m.seen_a end;
  if v_peer_seen < now() - interval '30 seconds' then
    perform public.rc_end_match(p_match);
    return jsonb_build_object('ended', true);
  end if;
  update public.matches
     set seen_a = case when user_a = p_user then now() else seen_a end,
         seen_b = case when user_b = p_user then now() else seen_b end
   where id = p_match;
  return jsonb_build_object('ended', false);
end $$;

-- ── 5. Matchmaking: same single lock, notification over Broadcast ──────────

create or replace function public.rc_notify_user(p_user uuid, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(p_payload, p_event, 'user:' || p_user::text, true);
exception when others then
  null; -- Realtime unavailable: the waiting client's poll heartbeat still finds the match
end $$;

create or replace function public.rc_try_pair(p_user uuid, p_filter text, p_country text, p_free integer)
returns jsonb language plpgsql as $$
declare
  me public.profiles%rowtype;
  cand record;
  v_blur_me text;
  v_blur_other text;
  v_match uuid;
begin
  select * into me from public.profiles where id = p_user;
  if not found then raise exception 'profile % not found', p_user; end if;

  select q.user_id, q.country_filter as cf,
         pr.matches_total, pr.bonus_matches, pr.plan_expires_at, pr.vip_until
    into cand
    from public.matchmaking_queue q
    join public.profiles pr on pr.id = q.user_id
   where q.user_id <> p_user
     and q.last_seen > now() - interval '15 seconds'
     and public.rc_gender_ok(p_filter, pr.gender)
     and public.rc_gender_ok(q.gender_filter, me.gender)
     and public.rc_country_ok(p_country, pr.country)
     and public.rc_country_ok(q.country_filter, me.country)
     and not exists (select 1 from public.matches mm
                      where mm.ended_at is null and q.user_id in (mm.user_a, mm.user_b))
   order by q.created_at
   limit 1;

  if found then
    v_blur_other := case
      when cand.plan_expires_at > now() or cand.vip_until > now() then null
      when cand.cf <> 'any' then 'location'
      when cand.matches_total >= p_free + cand.bonus_matches then 'tease'
      else null end;
    v_blur_me := case
      when me.plan_expires_at > now() or me.vip_until > now() then null
      when p_country <> 'any' then 'location'
      when me.matches_total >= p_free + me.bonus_matches then 'tease'
      else null end;

    -- The joiner (user_a) is always the WebRTC offerer; the waiting user answers.
    insert into public.matches (user_a, user_b, blur_a, blur_b)
    values (p_user, cand.user_id, v_blur_me, v_blur_other)
    returning id into v_match;

    update public.profiles set matches_total = matches_total + 1
     where id in (cand.user_id, p_user);
    delete from public.matchmaking_queue where user_id in (cand.user_id, p_user);

    -- Delivered when this transaction commits, on the waiting user's private channel.
    perform public.rc_notify_user(cand.user_id, 'matched', jsonb_build_object(
      'status', 'matched', 'matchId', v_match, 'role', 'answerer', 'blur', v_blur_other));
    return public.rc_match_state(p_user);
  end if;

  insert into public.matchmaking_queue (user_id, gender_filter, country_filter, last_seen)
  values (p_user, p_filter, p_country, now())
  on conflict (user_id) do update
    set gender_filter = excluded.gender_filter,
        country_filter = excluded.country_filter,
        last_seen = now();
  return jsonb_build_object('status', 'waiting');
end $$;

create or replace function public.rc_join_queue(p_user uuid, p_filter text, p_country text, p_free integer)
returns jsonb language plpgsql as $$
declare r record;
begin
  if p_filter not in ('both', 'boys', 'girls') then raise exception 'bad filter'; end if;
  if p_country <> 'any' and p_country !~ '^[A-Z]{2}$' then raise exception 'bad country'; end if;
  perform pg_advisory_xact_lock(727001);
  for r in select id from public.matches where ended_at is null and p_user in (user_a, user_b) loop
    perform public.rc_end_match(r.id);
  end loop;
  if exists (select 1 from public.bans b where b.user_id = p_user and (b.until is null or b.until > now())) then
    delete from public.matchmaking_queue where user_id = p_user;
    return jsonb_build_object('status', 'banned');
  end if;
  return public.rc_try_pair(p_user, p_filter, p_country, p_free);
end $$;

-- ── 6. Realtime Authorization (private Broadcast channels) ─────────────────
-- Topics: "match:<match id>" (the two participants of a live match send/receive
-- offer, answer and ICE) and "user:<user id>" (receive-only: match notifications).

create or replace function public.realtime_topic_allowed(p_topic text, p_send boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id text;
begin
  if v_uid is null then return false; end if;
  if p_topic like 'user:%' then
    return not p_send and p_topic = 'user:' || v_uid::text;
  end if;
  if p_topic like 'match:%' then
    v_id := substr(p_topic, 7);
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    return exists (select 1 from public.matches m
                    where m.id = v_id::uuid and m.ended_at is null and v_uid in (m.user_a, m.user_b));
  end if;
  return false;
end $$;
revoke execute on function public.realtime_topic_allowed(text, boolean) from public, anon;
grant  execute on function public.realtime_topic_allowed(text, boolean) to authenticated;

drop policy if exists rc_broadcast_receive on realtime.messages;
create policy rc_broadcast_receive on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast'
         and public.realtime_topic_allowed((select realtime.topic()), false));

drop policy if exists rc_broadcast_send on realtime.messages;
create policy rc_broadcast_send on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast'
              and public.realtime_topic_allowed((select realtime.topic()), true));

-- ── 7. Identity merge: anonymous visitor -> signed-in account ──────────────

create or replace function public.rc_merge_users(p_from uuid, p_into uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.profiles%rowtype;
  t public.profiles%rowtype;
  v_plan_left interval;
  v_vip_left  interval;
  v_plan      text;
  v_extra     integer;   -- bonus matches that did not come from referral tiers
  v_refs      integer;
  v_engaged   integer;
  v_t1        boolean;
  v_t2        boolean;
  v_new_from_tiers integer;
  r record;
begin
  if p_from = p_into then return jsonb_build_object('merged', false); end if;
  perform pg_advisory_xact_lock(727001); -- no pairing while the two identities move

  -- Lock both rows in a fixed order (no deadlocks with a concurrent merge).
  perform 1 from public.profiles where id in (p_from, p_into) order by id for update;
  select * into f from public.profiles where id = p_from;
  if not found then return jsonb_build_object('merged', false); end if;
  insert into public.profiles (id) values (p_into) on conflict (id) do nothing;
  select * into t from public.profiles where id = p_into;

  insert into public.identity_merges (from_user, into_user, before_from, before_into)
  values (p_from, p_into, to_jsonb(f), to_jsonb(t));

  -- End live chats / queue entries of the anonymous identity.
  for r in select id from public.matches where ended_at is null and p_from in (user_a, user_b) loop
    perform public.rc_end_match(r.id);
  end loop;
  delete from public.matchmaking_queue where user_id = p_from;

  -- Paid time: remaining time on both sides is ADDED, so no paid day is ever lost.
  v_plan_left := greatest(coalesce(f.plan_expires_at, now()) - now(), interval '0')
               + greatest(coalesce(t.plan_expires_at, now()) - now(), interval '0');
  v_vip_left  := greatest(coalesce(f.vip_until, now()) - now(), interval '0')
               + greatest(coalesce(t.vip_until, now()) - now(), interval '0');
  v_plan := case
    when v_plan_left = interval '0' then null
    when coalesce(t.plan_expires_at, '-infinity') >= coalesce(f.plan_expires_at, '-infinity')
         and t.plan_expires_at > now() then t.plan
    when f.plan_expires_at > now() then f.plan
    else t.plan end;

  -- Move everything that points at the anonymous identity.
  update public.orders   set user_id = p_into where user_id = p_from;
  update public.payments set user_id = p_into where user_id = p_from;
  update public.bans     set user_id = p_into where user_id = p_from;
  delete from public.signals where p_from in (from_user, to_user);
  delete from public.matches where (user_a = p_from and user_b = p_into) or (user_a = p_into and user_b = p_from);
  update public.matches set user_a = p_into where user_a = p_from;
  update public.matches set user_b = p_into where user_b = p_from;
  delete from public.reports where (reporter = p_from and reported = p_into) or (reporter = p_into and reported = p_from);
  update public.reports set reporter = p_into where reporter = p_from;
  update public.reports set reported = p_into where reported = p_from;
  update public.referral_code_aliases set user_id = p_into where user_id = p_from;
  insert into public.referral_code_aliases (code, user_id) values (f.referral_code, p_into)
  on conflict (code) do update set user_id = excluded.user_id;
  insert into public.referral_ips (referrer_id, ip_hash)
  select p_into, ip_hash from public.referral_ips where referrer_id = p_from
  on conflict do nothing;
  delete from public.referral_ips where referrer_id = p_from;

  -- People the anonymous identity invited now count for the account (never itself).
  update public.profiles set referred_by = p_into
   where referred_by = p_from and id not in (p_into, p_from);

  -- Referral totals are recounted from the referred users themselves, and each tier
  -- reward is paid once, so nothing is double counted.
  select count(*) filter (where referral_credited), count(*) filter (where engagement_counted)
    into v_refs, v_engaged
    from public.profiles where referred_by = p_into;
  v_extra := greatest(0, f.bonus_matches - (case when f.tier1_awarded then 5 else 0 end)
                                         - (case when f.tier2_awarded then 10 else 0 end))
           + greatest(0, t.bonus_matches - (case when t.tier1_awarded then 5 else 0 end)
                                         - (case when t.tier2_awarded then 10 else 0 end));
  v_t1 := f.tier1_awarded or t.tier1_awarded or v_refs >= 10;
  v_t2 := f.tier2_awarded or t.tier2_awarded or v_refs >= 20;
  v_new_from_tiers := (case when v_t1 then 5 else 0 end) + (case when v_t2 then 10 else 0 end);

  -- The anonymous profile goes first (frees its unique referral code, kept as an alias).
  delete from public.profiles where id = p_from;

  update public.profiles set
    plan              = v_plan,
    plan_billing      = case when v_plan is null then null else coalesce(t.plan_billing, f.plan_billing, 'once') end,
    plan_expires_at   = case when v_plan is null then null else now() + v_plan_left end,
    vip_until         = case when v_vip_left > interval '0' then now() + v_vip_left else null end,
    matches_total     = greatest(f.matches_total, t.matches_total),  -- never resets the free limit
    bonus_matches     = v_extra + v_new_from_tiers,
    referral_count    = v_refs,
    engaged_count     = v_engaged,
    tier1_awarded     = v_t1,
    tier2_awarded     = v_t2,
    engagement_awarded = f.engagement_awarded or t.engagement_awarded,
    age_verified      = f.age_verified or t.age_verified,
    gender            = coalesce(t.gender, f.gender),
    country           = coalesce(t.country, f.country),
    referred_by       = case when t.referred_by is not null then t.referred_by
                             when f.referred_by is distinct from p_into then f.referred_by end,
    referral_credited = case when t.referred_by is not null then t.referral_credited else f.referral_credited end,
    engagement_counted = case when t.referred_by is not null then t.engagement_counted else f.engagement_counted end,
    active_ms         = f.active_ms + t.active_ms,
    last_active       = greatest(f.last_active, t.last_active)
  where id = p_into;

  return jsonb_build_object('merged', true);
end $$;

-- ── 8. Account deletion: keep accounting records, drop personal data ───────

create or replace function public.rc_prepare_account_delete(p_user uuid)
returns void language plpgsql as $$
declare r record;
begin
  perform pg_advisory_xact_lock(727001);
  delete from public.matchmaking_queue where user_id = p_user;
  for r in select id from public.matches where ended_at is null and p_user in (user_a, user_b) loop
    perform public.rc_end_match(r.id);
  end loop;
  -- user_id is cleared by ON DELETE SET NULL when the profile goes; contact details now.
  update public.orders set billing_email = null, billing_phone = null where user_id = p_user;
  delete from public.identity_merges where p_user in (from_user, into_user);
  delete from public.referral_code_aliases where user_id = p_user;
end $$;

-- ── 9. Provider-neutral payments (PesaPal now, Stripe / PayPal later) ──────

create or replace function public.rc_order_create(
  p_merchant uuid, p_user uuid, p_product text, p_method text, p_currency text, p_amount numeric,
  p_provider text default 'pesapal', p_email text default null)
returns void language sql as $$
  insert into public.orders (merchant_reference, user_id, product, method, currency, amount, provider, billing_email)
  values (p_merchant, p_user, p_product, p_method, p_currency, p_amount, p_provider, p_email);
$$;

-- THE one place access is granted for money. The caller must already have verified the
-- payment with the provider's own API. Re-checks it against OUR stored order (provider,
-- transaction id, amount, currency) and grants exactly once: idempotent on
-- '<provider>_<transaction id>' in the payments ledger (same key format as before for
-- PesaPal, so old ledger rows still de-duplicate).
create or replace function public.rc_payment_fulfil(
  p_merchant uuid, p_provider text, p_txn text, p_amount numeric, p_currency text,
  p_days integer, p_hours integer)
returns jsonb language plpgsql as $$
declare
  o public.orders%rowtype;
  v_ref text;
  v_cents integer;
  v_granted boolean;
begin
  select * into o from public.orders where merchant_reference = p_merchant for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'completed' then
    return jsonb_build_object('ok', true, 'already', true, 'product', o.product, 'user_id', o.user_id);
  end if;
  if o.user_id is null then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;

  if o.provider is distinct from p_provider
     or p_txn is null or p_txn = ''
     or p_currency is distinct from o.currency
     or p_amount is null or abs(p_amount - o.amount) > 0.005
     or (o.order_tracking_id is not null and p_provider = 'pesapal' and o.order_tracking_id <> p_txn)
     or (o.provider_txn_id is not null and o.provider_txn_id <> p_txn) then
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  v_ref := p_provider || '_' || p_txn;
  v_cents := round(o.amount * 100)::integer;
  if o.product = 'vip24' then
    v_granted := public.rc_grant_vip(o.user_id, p_hours, v_ref, 'vip_pass', p_provider, false, v_cents);
  else
    v_granted := public.rc_activate_plan(o.user_id, o.product, v_ref, 'once', p_days, v_cents, p_provider);
  end if;

  update public.orders
     set status = 'completed', fulfilled_at = now(), provider_txn_id = p_txn,
         order_tracking_id = case when p_provider = 'pesapal' then coalesce(order_tracking_id, p_txn) else order_tracking_id end
   where merchant_reference = p_merchant;
  return jsonb_build_object('ok', true, 'already', not v_granted, 'product', o.product, 'user_id', o.user_id);
end $$;

-- ── 10. Lock every rc_* function to the server (service role only) ─────────

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'rc\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
