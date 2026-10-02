-- ============================================================================
-- RandomChat: complete app schema, RLS and server functions  (supabase/app.sql)
--
-- RUN THIS ONE FILE in Supabase -> SQL Editor. It is idempotent and RECONCILES
-- whatever is already in your database:
--   * empty database                         -> creates everything
--   * the minimal profiles + matchmaking_queue
--     schema (display_name / status / matched_with) -> keeps those tables and
--                                                columns, adds what the app needs
--   * the earlier "match_queue" schema        -> renames it to matchmaking_queue
-- Do NOT re-run the older minimal schema.sql / matchmaking.sql after this: they
-- recreate "viewable by everyone" policies that this file deliberately removes.
--
-- Postgres is the single source of truth. Matching, signaling, entitlements and
-- referrals run in server-only SQL functions (rc_*), called with the
-- service_role key, so every Vercel instance agrees. Browsers (anon / signed-in
-- anonymous users) can only read their OWN rows.
-- ============================================================================

-- ── 1. Tables (reconcile) ───────────────────────────────────────────────────

-- profiles: keeps the minimal schema's display_name; adds the app's columns.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  created_at    timestamptz not null default now()
);
alter table public.profiles add column if not exists display_name        text;
alter table public.profiles add column if not exists gender              text check (gender in ('boy', 'girl'));
alter table public.profiles add column if not exists country             text check (country ~ '^[A-Z]{2}$');
alter table public.profiles add column if not exists age_verified        boolean not null default false;
alter table public.profiles add column if not exists plan                text check (plan in ('weekly', 'fortnightly', 'monthly'));
alter table public.profiles add column if not exists plan_billing        text check (plan_billing in ('recurring', 'once'));
alter table public.profiles add column if not exists plan_expires_at     timestamptz;
alter table public.profiles add column if not exists vip_until           timestamptz;
alter table public.profiles add column if not exists matches_total       integer not null default 0 check (matches_total >= 0);
alter table public.profiles add column if not exists bonus_matches       integer not null default 0 check (bonus_matches >= 0);
alter table public.profiles add column if not exists referral_code       text not null unique
  default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
alter table public.profiles add column if not exists referred_by         uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists referral_credited   boolean not null default false;
alter table public.profiles add column if not exists engagement_counted  boolean not null default false;
alter table public.profiles add column if not exists referral_count      integer not null default 0 check (referral_count >= 0);
alter table public.profiles add column if not exists engaged_count       integer not null default 0 check (engaged_count >= 0);
alter table public.profiles add column if not exists tier1_awarded       boolean not null default false;
alter table public.profiles add column if not exists tier2_awarded       boolean not null default false;
alter table public.profiles add column if not exists engagement_awarded  boolean not null default false;
alter table public.profiles add column if not exists active_ms           bigint not null default 0 check (active_ms >= 0);
alter table public.profiles add column if not exists last_active         timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'no_self_referral') then
    alter table public.profiles add constraint no_self_referral
      check (referred_by is null or referred_by <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plan_fields_together') then
    alter table public.profiles add constraint plan_fields_together
      check ((plan is null) = (plan_expires_at is null));
  end if;
end $$;
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

-- matchmaking_queue: server-only. One row per waiting user.
do $$
begin
  if to_regclass('public.matchmaking_queue') is null and to_regclass('public.match_queue') is not null then
    alter table public.match_queue rename to matchmaking_queue;
  end if;
end $$;
create table if not exists public.matchmaking_queue (
  id            uuid not null default gen_random_uuid(),
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  status        text not null default 'waiting' check (status in ('waiting', 'matched', 'left')),
  matched_with  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.matchmaking_queue add column if not exists id             uuid not null default gen_random_uuid();
alter table public.matchmaking_queue add column if not exists status         text not null default 'waiting' check (status in ('waiting', 'matched', 'left'));
alter table public.matchmaking_queue add column if not exists matched_with   uuid references auth.users (id) on delete set null;
alter table public.matchmaking_queue add column if not exists gender_filter  text not null default 'both' check (gender_filter in ('both', 'boys', 'girls'));
alter table public.matchmaking_queue add column if not exists country_filter text not null default 'any' check (country_filter = 'any' or country_filter ~ '^[A-Z]{2}$');
alter table public.matchmaking_queue add column if not exists last_seen      timestamptz not null default now();
create index if not exists matchmaking_queue_last_seen_idx on public.matchmaking_queue (last_seen);

-- PesaPal orders (server-only). One row per checkout attempt; the IPN / callback verifies the
-- payment with PesaPal, then fulfils the order exactly once (see rc_fulfill_order).
create table if not exists public.orders (
  merchant_reference  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  product             text not null check (product in ('weekly', 'fortnightly', 'monthly', 'vip24')),
  method              text not null check (method in ('card', 'mpesa')),
  currency            text not null check (currency in ('USD', 'KES')),
  amount              numeric(12, 2) not null check (amount > 0),
  status              text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'reversed')),
  order_tracking_id   text unique,
  created_at          timestamptz not null default now(),
  fulfilled_at        timestamptz
);
create index if not exists orders_user_idx on public.orders (user_id);

-- Small server-only key/value store (e.g. the registered PesaPal IPN id per callback URL).
create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);


-- A "chat": two participants. user_a is the WebRTC offerer.
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references public.profiles (id) on delete cascade,
  user_b      uuid not null references public.profiles (id) on delete cascade,
  -- per-participant paywall treatment decided at match time (null = none)
  blur_a      text check (blur_a in ('tease', 'location')),
  blur_b      text check (blur_b in ('tease', 'location')),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  constraint distinct_participants check (user_a <> user_b)
);
create index if not exists matches_user_a_active_idx on public.matches (user_a) where ended_at is null;
create index if not exists matches_user_b_active_idx on public.matches (user_b) where ended_at is null;

-- WebRTC signaling inbox (offer / answer / ICE). Short-lived, never media.
create table if not exists public.signals (
  id          bigint generated always as identity primary key,
  match_id    uuid not null references public.matches (id) on delete cascade,
  from_user   uuid not null references public.profiles (id) on delete cascade,
  to_user     uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in ('offer', 'answer', 'ice')),
  payload     jsonb not null check (length(payload::text) <= 20000),
  created_at  timestamptz not null default now()
);
create index if not exists signals_inbox_idx on public.signals (to_user, id);
create index if not exists signals_match_idx on public.signals (match_id);

-- Safety reports.
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  reporter    uuid not null references public.profiles (id) on delete cascade,
  reported    uuid not null references public.profiles (id) on delete cascade,
  reason      text not null check (reason in ('nudity', 'harassment', 'underage', 'spam', 'other')),
  created_at  timestamptz not null default now(),
  constraint report_not_self check (reporter <> reported)
);
create index if not exists reports_reported_idx on public.reports (reported);

-- Payment / reward ledger. `ref` is the idempotency key (pesapal_<tracking id>,
-- engagement_<user>): inserting twice is a no-op.
create table if not exists public.payments (
  ref           text primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('plan', 'vip_pass', 'engagement_vip')),
  product       text,                                   -- weekly | fortnightly | monthly | vip24
  billing       text check (billing in ('recurring', 'once')),
  amount_cents  integer check (amount_cents >= 0),
  provider      text check (provider in ('pesapal', 'referral', 'mock')),
  created_at    timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id);

-- One credited referral per hashed IP per referrer (anti-farming). Server-only.
create table if not exists public.referral_ips (
  referrer_id  uuid not null references public.profiles (id) on delete cascade,
  ip_hash      text not null,
  created_at   timestamptz not null default now(),
  primary key (referrer_id, ip_hash)
);


-- ── 2. Auto-create a profile for every new (incl. anonymous) sign-in ────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, 'User_' || substr(new.id::text, 1, 6))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed in before this ran.
insert into public.profiles (id, display_name)
select id, 'User_' || substr(id::text, 1, 6) from auth.users
on conflict (id) do nothing;

-- ── 3. RLS helper functions (SECURITY DEFINER: no policy recursion) ─────────

-- True if the caller is a participant of this match AND it is still live.
create or replace function public.is_active_match_member(p_match uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.matches m
    where m.id = p_match
      and m.ended_at is null
      and (select auth.uid()) in (m.user_a, m.user_b)
  );
$$;

-- A signal may only travel between the two participants of a live match.
create or replace function public.signal_allowed(p_match uuid, p_from uuid, p_to uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_from <> p_to and exists (
    select 1 from public.matches m
    where m.id = p_match
      and m.ended_at is null
      and ((m.user_a = p_from and m.user_b = p_to) or (m.user_a = p_to and m.user_b = p_from))
  );
$$;

-- A report must name the OTHER participant of a match the reporter was in
-- (ended matches allowed: people report right after skipping).
create or replace function public.report_allowed(p_match uuid, p_reporter uuid, p_reported uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_reporter <> p_reported and exists (
    select 1 from public.matches m
    where m.id = p_match
      and ((m.user_a = p_reporter and m.user_b = p_reported) or (m.user_a = p_reported and m.user_b = p_reporter))
  );
$$;

revoke execute on function public.is_active_match_member(uuid)        from public, anon;
revoke execute on function public.signal_allowed(uuid, uuid, uuid)    from public, anon;
revoke execute on function public.report_allowed(uuid, uuid, uuid)    from public, anon;
revoke execute on function public.handle_new_user()                   from public, anon, authenticated;
grant  execute on function public.is_active_match_member(uuid)        to authenticated;
grant  execute on function public.signal_allowed(uuid, uuid, uuid)    to authenticated;
grant  execute on function public.report_allowed(uuid, uuid, uuid)    to authenticated;

-- ── 4. Lock everything down, then grant the minimum ─────────────────────────
-- Supabase grants ALL on new public tables to anon/authenticated by default.
-- Revoke that first so RLS is not the only line of defence.

alter table public.profiles          enable row level security;
alter table public.orders             enable row level security;
alter table public.app_settings       enable row level security;
alter table public.matchmaking_queue       enable row level security;
alter table public.matches           enable row level security;
alter table public.signals           enable row level security;
alter table public.reports           enable row level security;
alter table public.payments          enable row level security;
alter table public.referral_ips      enable row level security;

revoke all on public.profiles, public.matchmaking_queue, public.matches, public.signals,
  public.reports, public.payments, public.referral_ips, public.orders, public.app_settings
  from anon, authenticated;

-- profiles: read own row; edit ONLY gender + country (column-level grant).
-- plan, vip_until, bonus_matches, age_verified, referral_* etc. are server-written.
grant select on public.profiles to authenticated;
grant update (gender, country) on public.profiles to authenticated;

-- matches: read-only for participants.
grant select on public.matches to authenticated;

-- signals: participants exchange WebRTC messages with each other.
grant select, insert, delete on public.signals to authenticated;

-- reports: file and view your own reports.
grant select, insert on public.reports to authenticated;

-- payments: read your own receipts.
grant select on public.payments to authenticated;

-- matchmaking_queue, referral_ips, orders, app_settings:
-- no grants and no policies = no client access (service_role only).

-- Remove every pre-existing policy on the two reconciled tables (the minimal schema
-- shipped "viewable by everyone" read policies and client write policies on them),
-- then the strict policies below are the only ones.
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'public' and tablename in ('profiles', 'matchmaking_queue')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- ── 5. Policies (all keyed to auth.uid(); "authenticated" includes anonymous) ─

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Only live chats you are in. Once a chat ends it disappears for clients.
drop policy if exists matches_select_active_participant on public.matches;
create policy matches_select_active_participant on public.matches
  for select to authenticated
  using (ended_at is null and (select auth.uid()) in (user_a, user_b));

-- Receive messages addressed to you, in a chat that is still live.
drop policy if exists signals_select_recipient on public.signals;
create policy signals_select_recipient on public.signals
  for select to authenticated
  using (to_user = (select auth.uid()) and public.is_active_match_member(match_id));

-- Send only as yourself, only to the other participant, only in a live chat.
drop policy if exists signals_insert_sender on public.signals;
create policy signals_insert_sender on public.signals
  for insert to authenticated
  with check (
    from_user = (select auth.uid())
    and public.signal_allowed(match_id, from_user, to_user)
  );

-- Consume (delete) messages addressed to you.
drop policy if exists signals_delete_recipient on public.signals;
create policy signals_delete_recipient on public.signals
  for delete to authenticated
  using (to_user = (select auth.uid()));

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter = (select auth.uid()));

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter = (select auth.uid())
    and public.report_allowed(match_id, reporter, reported)
  );

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── 6. Realtime (signaling + match notifications respect the RLS above) ─────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.signals; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end;
    -- Lets the browser hear its OWN profile change (RLS: profiles_select_own) so Premium/VIP
    -- unlocks the UI instantly when a payment is fulfilled in the background.
    begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  end if;
end $$;

-- ── 7. Housekeeping (call from your /api/cron/daily with the service role) ──

create or replace function public.cleanup_stale()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.matchmaking_queue where last_seen < now() - interval '15 seconds';
  update public.matches set ended_at = now()
    where ended_at is null and created_at < now() - interval '6 hours';
  delete from public.signals where created_at < now() - interval '10 minutes';
  update public.profiles set plan = null, plan_billing = null, plan_expires_at = null
    where plan_expires_at is not null and plan_expires_at < now();
  update public.profiles set vip_until = null
    where vip_until is not null and vip_until < now();
$$;
revoke execute on function public.cleanup_stale() from public, anon, authenticated;
grant  execute on function public.cleanup_stale() to service_role;

-- ============================================================================
-- Server-side matchmaking, signaling, entitlements, referrals (rc_* functions)
-- ============================================================================

-- ── 0. Extra columns / constraint tweaks ────────────────────────────────────

alter table public.matches add column if not exists seen_a timestamptz not null default now();
alter table public.matches add column if not exists seen_b timestamptz not null default now();

-- Stripe and the M-Pesa simulation are gone: relabel any old test rows, then tighten the constraint.
alter table public.payments drop constraint if exists payments_provider_check;
update public.payments set provider = 'mock' where provider in ('stripe', 'mpesa');
alter table public.payments add constraint payments_provider_check
  check (provider in ('pesapal', 'referral', 'mock'));

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
    delete from public.matchmaking_queue where user_id in (cand.user_id, p_user);
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
declare q public.matchmaking_queue%rowtype;
begin
  perform pg_advisory_xact_lock(727001);
  perform public.rc_end_if_stale(p_user);
  if exists (select 1 from public.matches where ended_at is null and p_user in (user_a, user_b)) then
    return public.rc_match_state(p_user);
  end if;
  select * into q from public.matchmaking_queue where user_id = p_user;
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
  delete from public.matchmaking_queue where user_id = p_user;
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
returns jsonb language plpgsql security definer set search_path = '' as $$
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

-- ── 6. Entitlements (idempotent on p_ref: webhook + redirect + renewals) ────

create or replace function public.rc_activate_plan(
  p_user uuid, p_plan text, p_ref text, p_billing text, p_days integer,
  p_amount integer default null, p_provider text default 'pesapal')
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
  p_kind text default 'vip_pass', p_provider text default 'pesapal',
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

-- ── 8. PesaPal orders, settings + housekeeping ──────────────────────────────

create or replace function public.rc_create_order(
  p_merchant uuid, p_user uuid, p_product text, p_method text, p_currency text, p_amount numeric)
returns void language sql as $$
  insert into public.orders (merchant_reference, user_id, product, method, currency, amount)
  values (p_merchant, p_user, p_product, p_method, p_currency, p_amount);
$$;

create or replace function public.rc_set_order_tracking(p_merchant uuid, p_tracking text)
returns void language sql as $$
  update public.orders set order_tracking_id = p_tracking
   where merchant_reference = p_merchant and (order_tracking_id is null or order_tracking_id = p_tracking);
$$;

-- Look an order up by our merchant reference, or (fallback) by PesaPal's tracking id.
create or replace function public.rc_get_order(p_merchant uuid default null, p_tracking text default null)
returns jsonb language sql stable as $$
  select to_jsonb(o) from public.orders o
   where (p_merchant is not null and o.merchant_reference = p_merchant)
      or (p_merchant is null and p_tracking is not null and o.order_tracking_id = p_tracking)
   limit 1;
$$;

-- failed / reversed come from PesaPal's verified status; a completed order only moves to reversed.
create or replace function public.rc_mark_order(p_merchant uuid, p_status text)
returns void language sql as $$
  update public.orders set status = p_status
   where merchant_reference = p_merchant
     and (status = 'pending' or (p_status = 'reversed' and status = 'completed'));
$$;

-- Fulfil a VERIFIED payment exactly once. The caller has already confirmed with PesaPal
-- (GetTransactionStatus) that this tracking id is paid; here we re-check it matches OUR
-- order (amount, currency, tracking id), then grant the entitlement. Idempotent on
-- 'pesapal_<tracking id>' in the payments ledger, so webhook retries and the browser
-- redirect can both call it safely.
create or replace function public.rc_fulfill_order(
  p_merchant uuid, p_tracking text, p_amount numeric, p_currency text, p_days integer, p_hours integer)
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

  if p_currency is distinct from o.currency
     or p_amount is null or p_amount < o.amount - 0.005
     or (o.order_tracking_id is not null and o.order_tracking_id <> p_tracking) then
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  v_ref := 'pesapal_' || p_tracking;
  v_cents := round(o.amount * 100)::integer;
  if o.product = 'vip24' then
    v_granted := public.rc_grant_vip(o.user_id, p_hours, v_ref, 'vip_pass', 'pesapal', false, v_cents);
  else
    v_granted := public.rc_activate_plan(o.user_id, o.product, v_ref, 'once', p_days, v_cents, 'pesapal');
  end if;

  update public.orders
     set status = 'completed', fulfilled_at = now(), order_tracking_id = coalesce(order_tracking_id, p_tracking)
   where merchant_reference = p_merchant;
  return jsonb_build_object('ok', true, 'already', not v_granted, 'product', o.product, 'user_id', o.user_id);
end $$;

create or replace function public.rc_get_setting(p_key text)
returns text language sql stable as $$
  select value from public.app_settings where key = p_key;
$$;

create or replace function public.rc_set_setting(p_key text, p_value text)
returns void language sql as $$
  insert into public.app_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

create or replace function public.rc_daily_maintenance()
returns jsonb language plpgsql as $$
declare v_expired integer; v_users integer; v_reports integer;
begin
  with e as (
    update public.profiles set plan = null, plan_billing = null, plan_expires_at = null
     where plan_expires_at is not null and plan_expires_at < now() returning 1)
  select count(*) into v_expired from e;
  update public.profiles set vip_until = null where vip_until is not null and vip_until < now();
  delete from public.matchmaking_queue where last_seen < now() - interval '15 seconds';
  update public.matches set ended_at = now()
   where ended_at is null and least(seen_a, seen_b) < now() - interval '30 seconds';
  delete from public.signals s using public.matches m
   where s.match_id = m.id and m.ended_at is not null;
  select count(*) into v_users from public.profiles;
  select count(*) into v_reports from public.reports;
  return jsonb_build_object('expired', v_expired, 'users', v_users, 'reports', v_reports);
end $$;

-- ── Retire the Stripe / M-Pesa-simulation objects from earlier versions ────
drop function if exists public.rc_mpesa_create(uuid);
drop function if exists public.rc_mpesa_status(uuid, uuid, integer, integer, integer);
drop function if exists public.rc_set_stripe_customer(uuid, text);
drop function if exists public.rc_get_stripe_customer(uuid);
drop table if exists public.mpesa_requests;
drop table if exists public.billing_customers;

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

-- ============================================================================
-- OPTIONAL, intentionally NOT enabled: storing chat text.
-- RandomChat sends text over the WebRTC data channel and stores none of it, and
-- the Privacy Policy says so. Only uncomment if you decide to change that (and
-- update the policy). Participants could then read/write only their live chats:
--
-- create table if not exists public.messages (
--   id         bigint generated always as identity primary key,
--   match_id   uuid not null references public.matches (id) on delete cascade,
--   sender     uuid not null references public.profiles (id) on delete cascade,
--   body       text not null check (length(body) between 1 and 500),
--   created_at timestamptz not null default now()
-- );
-- create index on public.messages (match_id, id);
-- alter table public.messages enable row level security;
-- revoke all on public.messages from anon, authenticated;
-- grant select, insert on public.messages to authenticated;
-- create policy messages_read on public.messages for select to authenticated
--   using (public.is_active_match_member(match_id));
-- create policy messages_write on public.messages for insert to authenticated
--   with check (sender = (select auth.uid()) and public.is_active_match_member(match_id));
-- ============================================================================
