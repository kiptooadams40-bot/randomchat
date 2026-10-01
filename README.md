# RandomChat

Random 1-to-1 video chat (Next.js 15, WebRTC, Tailwind 4). Runs with zero external accounts.

```
copy .env.example .env.local
npm install
npm run dev        # http://localhost:3000 — open two browser windows (one incognito) and press Start
```

## How it works
- **Matching + signaling**: `src/lib/store.ts` (in-memory mock DB/queue) behind HTTP-polling routes in `src/app/api/{match,signal}`. Client logic is `src/hooks/useRandomChat.ts` (offer/answer/ICE, data-channel text chat, auto-requeue on skip/disconnect).
- **ICE**: public STUN from `ICE_STUN_URLS`; TURN is added only if `TURN_URLS` is set (needed for symmetric/CGNAT users).
- **Payments**: with a real `sk_test_…` key, Stripe Checkout (test mode, card 4242…) + `/api/billing/webhook`. Without one, a mock checkout page is used. Mock is refused when `APP_ENV=production`.
- **Age gate**: self-declared mock, refused in production (fails closed until a real provider such as Yoti is wired in).

## Before production
The in-memory store does not work across serverless instances or restarts. Replace `src/lib/store.ts` with Supabase (users, reports, subscriptions) and Upstash Redis (queue, signal inboxes) — both are already in `package.json`. Also needed: real age assurance, moderation, and a TURN server.
