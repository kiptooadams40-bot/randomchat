-- ============================================================================
-- RandomChat: Supabase schema + Row Level Security
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run (idempotent).
--
-- Model: every visitor signs in anonymously (auth.uid() = their id).
--   * Clients (anon-signed-in users, role "authenticated") may only touch their
--     OWN rows, and may never write money/entitlement columns.
--   * Matching, payments, referrals and reports-handling run on the server with
--     the service_role key (bypasses RLS). Nothing in the browser can grant
--     itself Premium, VIP, bonus matches or referral credit.
-- ============================================================================

-- ── 1. Tables ───────────────────────────────────────────────────────────────

-- One row per user (created automatically on sign-in, see trigger below).
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  -- self-declared, optional; only used by the Premium Boys/Girls filter
  gender              text check (gender in ('boy', 'girl')),
  country             text check (country ~ '^[A-Z]{2}$'),
  age_verified        boolean not null default false,
  -- Premium subscription / one-time plan
  plan                text check (plan in ('weekly', 'fortnightly', 'monthly')),
  plan_billing        text check (plan_billing in ('recurring', 'once')),
  plan_expires_at     timestamptz,
  -- VIP pass (bought 24h pass or earned engagement pass): absolute expiry
  vip_until           timestamptz,
  -- usage / free tier
  matches_total       integer not null default 0 check (matches_total >= 0),
  bonus_matches       integer not null default 0 check (bonus_matches >= 0),
  -- referrals
  referral_code       text not null unique
                        default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  referred_by         uuid references public.profiles (id) on delete set null,
  referral_credited   boolean not null default false,
  engagement_counted  boolean not null default false,
  referral_count      integer not null default 0 check (referral_count >= 0),
  engaged_count       integer not null default 0 check (engaged_count >= 0),
  tier1_awarded       boolean not null default false,
  tier2_awarded       boolean not null default false,
  engagement_awarded  boolean not null default false,
  active_ms           bigint not null default 0 check (active_ms >= 0),
  last_active         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint no_self_referral check (referred_by is null or referred_by <> id),
  constraint plan_fields_together check ((plan is null) = (plan_expires_at is null))
);
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

-- Stripe customer ids are private: server-only table, no client access at all.
create table if not exists public.billing_customers (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id  text not null unique,
  created_at          timestamptz not null default now()
);

-- Matchmaking queue (server-only). One row per waiting user.
create table if not exists public.match_queue (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  gender_filter   text not null default 'both' check (gender_filter in ('both', 'boys', 'girls')),
  country_filter  text not null default 'any'
                    check (country_filter = 'any' or country_filter ~ '^[A-Z]{2}$'),
  last_seen       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists match_queue_last_seen_idx on public.match_queue (last_seen);

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

-- Payment / reward ledger. `ref` is the idempotency key (Stripe session or
-- invoice id, mpesa_<id>, engagement_<user>): inserting twice is a no-op.
create table if not exists public.payments (
  ref           text primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('plan', 'vip_pass', 'engagement_vip')),
  product       text,                                   -- weekly | fortnightly | monthly | vip24
  billing       text check (billing in ('recurring', 'once')),
  amount_cents  integer check (amount_cents >= 0),
  provider      text check (provider in ('stripe', 'mpesa', 'referral')),
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

-- M-Pesa STK push requests (server-only; replace simulation with Daraja/Pesapal ids).
create table if not exists public.mpesa_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index if not exists mpesa_requests_user_idx on public.mpesa_requests (user_id);

-- ── 2. Auto-create a profile for every new (incl. anonymous) sign-in ────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed in before this script ran.
insert into public.profiles (id)
select id from auth.users
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
alter table public.billing_customers enable row level security;
alter table public.match_queue       enable row level security;
alter table public.matches           enable row level security;
alter table public.signals           enable row level security;
alter table public.reports           enable row level security;
alter table public.payments          enable row level security;
alter table public.referral_ips      enable row level security;
alter table public.mpesa_requests    enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

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

-- billing_customers, match_queue, referral_ips, mpesa_requests:
-- no grants and no policies = no client access (service_role only).

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
  end if;
end $$;

-- ── 7. Housekeeping (call from your /api/cron/daily with the service role) ──

create or replace function public.cleanup_stale()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.match_queue where last_seen < now() - interval '15 seconds';
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
