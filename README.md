# RandomChat

Random 1-to-1 video chat (Next.js 15, WebRTC, Tailwind 4, Supabase).

## Setup
1. **Supabase**: create a project. In **Authentication → Sign In / Providers** enable **Allow anonymous sign-ins** and
   **Email** (email codes). Put `{{ .Token }}` in the **Magic Link** and **Confirm signup** email templates so people get a
   6-digit code. Set up custom SMTP. In **Realtime → Settings** turn off **Allow public access** (private channels only).
2. In the SQL Editor run **[`supabase/app.sql`](supabase/app.sql)**, then **[`supabase/identity.sql`](supabase/identity.sql)**.
   Both are idempotent. **Do not re-run the older `schema.sql` / `matchmaking.sql`**: they recreate public-read policies.
3. `copy .env.example .env.local` and fill it in. Set the same variables in Vercel.
4. `npm install && npm run dev`, then open two browsers (one incognito) and press Start. Add `?debug=1` to `/chat`
   to see connection timings.

## Architecture
- **Postgres is the single source of truth.** Queue, matches, profiles, entitlements, referrals, orders and the
  payment ledger live in Supabase; server code calls `rc_*` SQL functions with the secret key ([`src/lib/repo.ts`](src/lib/repo.ts)).
- **Identity**: every visitor gets a Supabase anonymous user (no sign-up to chat). Optional sign-in with an email +
  6-digit code (`/api/auth/*`) merges the anonymous identity into the account (`rc_merge_users`): remaining Premium/VIP
  time is added together, matches used takes the higher value, referrals are recounted with each reward paid once.
- **Matching** is atomic under one Postgres lock (`rc_join_queue`). The waiting user is told over a private Realtime
  Broadcast channel `user:<id>` (sent by `realtime.send` inside the pairing transaction).
- **Signaling**: offer / answer / trickle ICE go over the private Broadcast channel `match:<id>`, never through the
  database. The joiner always makes the offer. One ICE restart at 8s, then move on.
- **ICE**: `stun.cloudflare.com` plus Cloudflare Realtime TURN with short-lived credentials from `/api/ice`.
- **Payments**: PesaPal API v3. Access is granted only by `fulfilVerifiedPayment` ([`src/lib/payments.ts`](src/lib/payments.ts)),
  after `GetTransactionStatus` confirms the payment and it matches the stored order; IPN and the return page share that
  exactly-once path. Stripe / PayPal webhooks will call the same function.
- **Referrals** count once the invited person has a 60s+ chat with someone other than the inviter.

## Before launch
Real age assurance (the self-declared check is not enough), content moderation, CAPTCHA on anonymous sign-in, and
legal review of the policy pages.
