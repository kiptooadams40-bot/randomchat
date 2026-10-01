-- ============================================================================
-- RandomChat: server-side matchmaking, signaling and billing functions.
-- Run AFTER supabase/schema.sql (SQL Editor -> paste -> Run). Safe to re-run.
--
-- The Postgres tables are the single source of truth. Every Vercel instance
-- calls these functions (via supabase.rpc with the service_role key), so all
-- instances see the same queue, matches and signals.
--
-- Concurrency: pairing runs under one transaction-scoped advisory lock, so two
-- users joining at the same instant on different instances can never be
-- double-matched or both left waiting forever.
-- ============================================================================

-- ── 0. Extra columns / constraint tweaks ────────────────────────────────────

alter table public.matches add column if not exists seen_a timestamptz not null default now();
alter table public.matches add column if not exists seen_b timestamptz not null default now();

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('stripe', 'mpesa', 'referral', 'mock'));

-- ── 1. Small pure helpers ───────────────────────────────────────────────────

create or replace function public.rc_gender_ok(f text, g text)
returns boolean language sql immutable as $$
  select f = 'both' or (f = 'boys' and g = 'boy') or (f = 'girls' and g = 'girl');
$$;

create or replace function public.rc_country_ok(f text, c text)
returns boolean language sql immutable as $$
  select f = 'any' or f = c;
$$;

-- ── 2. Matches: state, ending, staleness ────────────────────────────────────

-- Current match for a user as the JSON the API returns (teaseMs is added by the app).
create or replace function public.rc_match_state(p_user uuid)
returns jsonb language plpgsql as $$
declare m public.matches;
begin
  select * into m from public.matches
   where ended_at is null and p_user in (user_a, user_b)
   order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'waiting');
  end if;
  return jsonb_build_object(
    'status', 'matched',
    'matchId', m.id,
    'role', case when m.user_a = p_user then 'offerer' else 'answerer' end,
    'blur', case when m.user_a = p_user then m.blur_a else m.blur_b end
  );
end $$;

create or replace function public.rc_end_match(p_match uuid)
returns void language plpgsql as $$
begin
  update public.matches set ended_at = now() where id = p_match and ended_at is null;
  delete from public.signals where match_id = p_match;
end $$;

-- A match whose participant stopped polling (closed tab) is dead after 30s.
create or replace function public.rc_end_if_stale(p_user uuid)
returns void language plpgsql as $$
declare r record;
begin
  for r in
    select id from public.matches
     where ended_at is null and p_user in (user_a, user_b)
       and least(seen_a, seen_b) < now() - interval '30 seconds'
  loop
    perform public.rc_end_match(r.id);
  end loop;
end $$;

-- ── 3. Matchmaking queue ────────────────────────────────────────────────────

-- Find a compatible waiting partner for p_user and pair them, or (re)enqueue.
-- Caller must already hold the matchmaking advisory lock.
create or replace function public.rc_try_pair(p_user uuid, p_filter text, p_country text, p_free integer)
returns jsonb language plpgsql as $$
declare
  me public.profiles%rowtype;
  cand record;
  v_blur_me text;
  v_blur_other text;
begin
  select * into me from public.profiles where id = p_user;
  if not found then raise exception 'profile % not found', p_user; end if;

  -- Filters are mutual: I must accept them AND they must accept me.
  select q.user_id, q.country_filter as cf,
         pr.matches_total, pr.bonus_matches, pr.plan_expires_at, pr.vip_until
    into cand
    from public.match_queue q
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
    -- Paywall treatment is decided BEFORE counting this match.
    -- Access (Premium or VIP): never blurred. Free + region search: blurred from the start.
    -- Free + past the free allowance: 10s clear, then blurred.
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

    -- The partner who was waiting first is the WebRTC offerer.
    insert into public.matches (user_a, user_b, blur_a, blur_b)
    values (cand.user_id, p_user, v_blur_other, v_blur_me);

    update public.profiles set matches_total = matches_total + 1
     where id in (cand.user_id, p_user);
    delete from public.match_queue where user_id in (cand.user_id, p_user);
    return public.rc_match_state(p_user);
  end if;

  insert into public.match_queue (user_id, gender_filter, country_filter, last_seen)
  values (p_user, p_filter, p_country, now())
  on conflict (user_id) do update
    set gender_filter = excluded.gender_filter,
        country_filter = excluded.country_filter,
        last_seen = now();
  return jsonb_build_object('status', 'waiting');
end $$;

create or replace function public.rc_join_queue(p_user uuid, p_filter text, p_country text, p_free integer)
returns jsonb language plpgsql as $$
begin
  if p_filter not in ('both', 'boys', 'girls') then raise exception 'bad filter'; end if;
  if p_country <> 'any' and p_country !~ '^[A-Z]{2}$' then raise exception 'bad country'; end if;
  perform pg_advisory_xact_lock(727001);
  perform public.rc_end_if_stale(p_user);
  if exists (select 1 from public.matches where ended_at is null and p_user in (user_a, user_b)) then
    return public.rc_match_state(p_user);
  end if;
  return public.rc_try_pair(p_user, p_filter, p_country, p_free);
end $$;

-- Polled every second while waiting. Also RE-TRIES pairing, so two users who
-- enqueued at the same instant still find each other on the next poll.
create or replace function public.rc_poll_match(p_user uuid, p_free integer)
returns jsonb language plpgsql as $$
declare q public.match_queue%rowtype;
begin
  perform pg_advisory_xact_lock(727001);
  perform public.rc_end_if_stale(p_user);
  if exists (select 1 from public.matches where ended_at is null and p_user in (user_a, user_b)) then
    return public.rc_match_state(p_user);
  end if;
  select * into q from public.match_queue where user_id = p_user;
  if not found then
    return jsonb_build_object('status', 'waiting');
  end if;
  return public.rc_try_pair(p_user, q.gender_filter, q.country_filter, p_free);
end $$;

create or replace function public.rc_leave(p_user uuid)
returns void language plpgsql as $$
declare r record;
begin
  perform pg_advisory_xact_lock(727001);
  delete from public.match_queue where user_id = p_user;
  for r in select id from public.matches where ended_at is null and p_user in (user_a, user_b) loop
    perform public.rc_end_match(r.id);
  end loop;
end $$;

-- ── 4. Signaling (WebRTC offer / answer / ICE) ──────────────────────────────

create or replace function public.rc_push_signal(p_match uuid, p_from uuid, p_type text, p_payload jsonb)
returns boolean language plpgsql as $$
declare m public.matches;
begin
  select * into m from public.matches
   where id = p_match and ended_at is null and p_from in (user_a, user_b);
  if not found then return false; end if;
  insert into public.signals (match_id, from_user, to_user, type, payload)
  values (p_match, p_from, case when m.user_a = p_from then m.user_b else m.user_a end, p_type,
          coalesce(p_payload, 'null'::jsonb));   -- a missing payload must not crash the insert
  return true;
end $$;

-- Returns {"messages":[...]} (and clears them), or {"ended":true}.
create or replace function public.rc_drain_signals(p_match uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare
  m public.matches;
  v_peer_seen timestamptz;
  v_msgs jsonb;
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

  with d as (
    delete from public.signals where match_id = p_match and to_user = p_user
    returning id, type, payload
  )
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'payload', payload) order by id), '[]'::jsonb)
    into v_msgs from d;
  return jsonb_build_object('messages', v_msgs);
end $$;

create or replace function public.rc_report(p_match uuid, p_reporter uuid, p_reason text)
returns boolean language plpgsql as $$
declare m public.matches; v_reported uuid;
begin
  select * into m from public.matches where id = p_match and p_reporter in (user_a, user_b);
  if not found then return false; end if;
  v_reported := case when m.user_a = p_reporter then m.user_b else m.user_a end;
  insert into public.reports (match_id, reporter, reported, reason) values (p_match, p_reporter, v_reported, p_reason);
  return true;
end $$;

-- ── 5. Profiles ─────────────────────────────────────────────────────────────

-- Get (creating if the sign-in trigger somehow missed it) a user's profile as JSON.
create or replace function public.rc_get_profile(p_user uuid)
returns jsonb language plpgsql as $$
begin
  insert into public.profiles (id)
  select id from auth.users where id = p_user
  on conflict (id) do nothing;
  return (select to_jsonb(p) from public.profiles p where p.id = p_user);
end $$;

-- p_patch may contain "gender" and/or "country" (null clears). Nothing else is writable.
create or replace function public.rc_update_profile(p_user uuid, p_patch jsonb)
returns void language plpgsql as $$
begin
  update public.profiles
     set gender  = case when p_patch ? 'gender'  then p_patch ->> 'gender'  else gender  end,
         country = case when p_patch ? 'country' then p_patch ->> 'country' else country end
   where id = p_user;
end $$;

create or replace function public.rc_set_age_verified(p_user uuid)
returns void language sql as $$
  update public.profiles set age_verified = true where id = p_user;
$$;

-- Attribute a brand-new user (<10 min old) to the referrer owning p_code.
create or replace function public.rc_set_referrer(p_user uuid, p_code text)
returns void language sql as $$
  update public.profiles
     set referred_by = (select id from public.profiles where referral_code = p_code and id <> p_user)
   where id = p_user and referred_by is null and created_at > now() - interval '10 minutes';
$$;

create or replace function public.rc_referrer_exists(p_code text)
returns boolean language sql stable as $$
  select exists (select 1 from public.profiles where referral_code = p_code);
$$;

create or replace function public.rc_set_stripe_customer(p_user uuid, p_customer text)
returns void language sql as $$
  insert into public.billing_customers (user_id, stripe_customer_id) values (p_user, p_customer)
  on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id;
$$;

create or replace function public.rc_get_stripe_customer(p_user uuid)
returns text language sql stable as $$
  select stripe_customer_id from public.billing_customers where user_id = p_user;
$$;

-- ── 6. Entitlements (idempotent on p_ref: webhook + redirect + renewals) ────

create or replace function public.rc_activate_plan(
  p_user uuid, p_plan text, p_ref text, p_billing text, p_days integer,
  p_amount integer default null, p_provider text default 'stripe')
returns boolean language plpgsql as $$
declare v_n integer;
begin
  if not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  insert into public.payments (ref, user_id, kind, product, billing, amount_cents, provider)
  values (p_ref, p_user, 'plan', p_plan, p_billing, p_amount, p_provider)
  on conflict (ref) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;       -- already applied

  update public.profiles
     set plan = p_plan,
         plan_billing = p_billing,
         plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => p_days)
   where id = p_user;
  return true;
end $$;

-- p_fixed = false: bought pass, stacks onto an active pass.
-- p_fixed = true : expiry is exactly now()+hours (never shortens a longer pass).
create or replace function public.rc_grant_vip(
  p_user uuid, p_hours integer, p_ref text,
  p_kind text default 'vip_pass', p_provider text default 'stripe',
  p_fixed boolean default false, p_amount integer default null)
returns boolean language plpgsql as $$
declare v_n integer;
begin
  if not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  insert into public.payments (ref, user_id, kind, product, amount_cents, provider)
  values (p_ref, p_user, p_kind, 'vip24', p_amount, p_provider)
  on conflict (ref) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;

  update public.profiles
     set vip_until = case
           when p_fixed then greatest(coalesce(vip_until, now()), now() + make_interval(hours => p_hours))
           else greatest(coalesce(vip_until, now()), now()) + make_interval(hours => p_hours)
         end
   where id = p_user;
  return true;
end $$;

-- ── 7. Referrals ────────────────────────────────────────────────────────────

-- Called when a referred user's first chat connects. One credit per hashed IP per
-- referrer when p_enforce_ip. Tier rewards are one-time and cumulative.
create or replace function public.rc_credit_referral(
  p_user uuid, p_ip_hash text, p_enforce_ip boolean,
  p_t1_refs integer, p_t1_bonus integer, p_t2_refs integer, p_t2_bonus integer)
returns boolean language plpgsql as $$
declare u public.profiles%rowtype; v_n integer;
begin
  select * into u from public.profiles where id = p_user for update;
  if not found or u.referred_by is null or u.referral_credited or not u.age_verified then
    return false;
  end if;
  if p_enforce_ip then
    insert into public.referral_ips (referrer_id, ip_hash) values (u.referred_by, p_ip_hash)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then return false; end if;
  end if;

  update public.profiles set referral_credited = true where id = p_user;
  update public.profiles set referral_count = referral_count + 1 where id = u.referred_by;
  update public.profiles set tier1_awarded = true, bonus_matches = bonus_matches + p_t1_bonus
   where id = u.referred_by and not tier1_awarded and referral_count >= p_t1_refs;
  update public.profiles set tier2_awarded = true, bonus_matches = bonus_matches + p_t2_bonus
   where id = u.referred_by and not tier2_awarded and referral_count >= p_t2_refs;
  return true;
end $$;

-- Accumulates "active" time (gaps > 30s don't count) for credited referred users, and
-- awards the referrer a FIXED-EXPIRY VIP pass once p_users referred users passed p_minutes.
create or replace function public.rc_touch_activity(
  p_user uuid, p_minutes integer, p_users integer, p_vip_hours integer)
returns void language plpgsql as $$
declare
  u public.profiles%rowtype;
  v_delta bigint;
  v_active bigint;
  r public.profiles%rowtype;
begin
  select * into u from public.profiles where id = p_user for update;
  if not found then return; end if;
  v_delta := (extract(epoch from (now() - u.last_active)) * 1000)::bigint;
  v_active := u.active_ms + case when v_delta < 30000 then v_delta else 0 end;
  update public.profiles set last_active = now(), active_ms = v_active where id = p_user;

  if u.referral_credited and not u.engagement_counted and u.referred_by is not null
     and v_active >= p_minutes * 60000 then
    update public.profiles set engagement_counted = true where id = p_user;
    update public.profiles set engaged_count = engaged_count + 1
     where id = u.referred_by returning * into r;
    if r.engaged_count >= p_users and not r.engagement_awarded then
      update public.profiles set engagement_awarded = true where id = r.id;
      perform public.rc_grant_vip(r.id, p_vip_hours, 'engagement_' || r.id::text,
                                  'engagement_vip', 'referral', true, null);
    end if;
  end if;
end $$;

-- ── 8. M-Pesa simulation + housekeeping ─────────────────────────────────────

create or replace function public.rc_mpesa_create(p_user uuid)
returns uuid language sql as $$
  insert into public.mpesa_requests (user_id) values (p_user) returning id;
$$;

-- SIMULATION: the "customer enters their PIN" p_delay_ms after the push.
create or replace function public.rc_mpesa_status(p_id uuid, p_user uuid, p_delay_ms integer, p_hours integer, p_amount integer)
returns text language plpgsql as $$
declare r public.mpesa_requests;
begin
  select * into r from public.mpesa_requests where id = p_id and user_id = p_user;
  if not found then return null; end if;
  if r.status = 'pending' and r.created_at < now() - make_interval(secs => p_delay_ms / 1000.0) then
    update public.mpesa_requests set status = 'paid', paid_at = now() where id = p_id;
    perform public.rc_grant_vip(p_user, p_hours, 'mpesa_' || p_id::text, 'vip_pass', 'mpesa', false, p_amount);
    return 'paid';
  end if;
  return r.status;
end $$;

create or replace function public.rc_daily_maintenance()
returns jsonb language plpgsql as $$
declare v_expired integer; v_users integer; v_reports integer;
begin
  with e as (
    update public.profiles set plan = null, plan_billing = null, plan_expires_at = null
     where plan_expires_at is not null and plan_expires_at < now() returning 1)
  select count(*) into v_expired from e;
  update public.profiles set vip_until = null where vip_until is not null and vip_until < now();
  delete from public.match_queue where last_seen < now() - interval '15 seconds';
  update public.matches set ended_at = now()
   where ended_at is null and least(seen_a, seen_b) < now() - interval '30 seconds';
  delete from public.signals s using public.matches m
   where s.match_id = m.id and m.ended_at is not null;
  select count(*) into v_users from public.profiles;
  select count(*) into v_reports from public.reports;
  return jsonb_build_object('expired', v_expired, 'users', v_users, 'reports', v_reports);
end $$;

-- ── 9. Lock the RPCs to the server ──────────────────────────────────────────
-- Anyone on the internet holds the anon key. These functions can grant Premium,
-- so only service_role (server code with the secret key) may execute them.

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

-- Make PostgREST see the new functions immediately.
notify pgrst, 'reload schema';
