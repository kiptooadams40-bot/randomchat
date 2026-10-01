# RandomChat

Random 1-to-1 video chat (Next.js 15, WebRTC, Tailwind 4, Supabase).

## Setup
1. **Supabase**: create a project, enable **Authentication → Sign In / Providers → Allow anonymous sign-ins**
   (turn on CAPTCHA/Turnstile under Attack Protection, anonymous sign-ins are abusable without it).
2. In the SQL Editor run, in order: [`supabase/schema.sql`](supabase/schema.sql) then
   [`supabase/matchmaking.sql`](supabase/matchmaking.sql). Both are safe to re-run.
3. `copy .env.example .env.local` and fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `NEXT_PUBLIC_`). Set the same variables in Vercel.
4. `npm install && npm run dev`, then open two browsers (one incognito) and press Start.

## Architecture
- **Postgres is the single source of truth.** The matchmaking queue, matches, WebRTC signaling inbox, profiles,
  entitlements, referrals and payment ledger all live in Supabase, so any number of Vercel instances agree.
- **Matching is atomic.** `rc_join_queue` / `rc_poll_match` pair users inside Postgres under one advisory lock
  (no double-matches, no lost waiters). Waiting users re-try pairing on every poll.
- **Server-only RPCs.** All `rc_*` functions are executable by `service_role` only. A browser holding the public
  anon key cannot grant itself Premium/VIP or touch the queue. Data access is in [`src/lib/repo.ts`](src/lib/repo.ts).
- **Identity** is Supabase anonymous auth (`src/lib/session.ts`); `src/middleware.ts` keeps the session fresh.
- **ICE**: public STUN by default; add TURN via `TURN_URLS` for users behind symmetric NAT.
- **Payments**: Stripe (test mode) with a mock fallback outside production. M-Pesa is a **simulation** (refused in production).

## Before launch
Real age assurance (the self-declared check is not enough), content moderation, a TURN server, CAPTCHA on
anonymous sign-in, and legal review of the policy pages.
