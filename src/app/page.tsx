import Link from "next/link";
import { FREE_MATCHES, REFERRAL } from "@/lib/plans";

const FEATURES = [
  ["Instant matching", "One click and you're paired with a random adult, peer-to-peer over WebRTC."],
  ["Chat across languages", "Built-in text translation between English, French and Spanish."],
  ["Safety first", "18+ only, one-tap reporting, and Next whenever you want out."],
];

const STEPS = [
  ["1", "Confirm you're 18+", "A quick age check, no account needed."],
  ["2", "Press Start", "Allow your camera and we find someone new."],
  ["3", "Talk, or hit Next", "Enjoy the chat, or skip to the next person."],
];

export default function Home() {
  return (
    <div className="py-10 text-center">
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
        Meet someone <span className="text-violet-400">new</span>, right now.
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-neutral-400">
        Random video chat for adults. No sign-up. Your first {FREE_MATCHES} matches are completely free.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/chat" className="rounded-full bg-violet-600 px-8 py-3 font-semibold hover:bg-violet-500">
          Start chatting free
        </Link>
        <Link href="/pricing" className="rounded-full border border-white/20 px-8 py-3 font-semibold hover:bg-white/5">
          See Premium
        </Link>
      </div>

      <section className="mt-16 grid gap-4 text-left sm:grid-cols-3" aria-label="Features">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-white/10 bg-neutral-900/60 p-5">
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-2 text-sm text-neutral-400">{d}</p>
          </div>
        ))}
      </section>

      <section className="mt-16" aria-label="How it works">
        <h2 className="text-2xl font-bold">How it works</h2>
        <ol className="mt-6 grid gap-4 text-left sm:grid-cols-3">
          {STEPS.map(([n, t, d]) => (
            <li key={n} className="rounded-2xl border border-white/10 p-5">
              <span className="text-2xl font-extrabold text-violet-400">{n}</span>
              <h3 className="mt-1 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-neutral-400">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 rounded-3xl border border-white/10 p-8" aria-label="Invite friends">
        <h2 className="text-2xl font-bold">Invite friends, get free matches</h2>
        <p className="mx-auto mt-2 max-w-lg text-neutral-300">
          {REFERRAL.tier1.referrals} referrals = {REFERRAL.tier1.bonusMatches} extra free matches. {REFERRAL.tier2.referrals} referrals = {REFERRAL.tier2.bonusMatches} more.
        </p>
        <Link href="/invite" className="mt-5 inline-block rounded-full border border-white/20 px-8 py-3 font-semibold hover:bg-white/5">
          Get my invite link
        </Link>
      </section>

      <section className="mt-6 rounded-3xl border border-violet-500/40 bg-violet-950/30 p-8" aria-label="Premium">
        <h2 className="text-2xl font-bold">Go Premium</h2>
        <p className="mx-auto mt-2 max-w-lg text-neutral-300">
          Unlimited chat time, no blur, and the Boys / Girls / Both filter. Pay once with card or M-Pesa. Nothing renews.
        </p>
        <Link href="/pricing" className="mt-5 inline-block rounded-full bg-violet-600 px-8 py-3 font-semibold hover:bg-violet-500">
          Unlock Premium
        </Link>
        <p className="mt-3 text-xs text-neutral-500">
          Questions? Read the <Link href="/faq" className="underline">FAQ</Link>.
        </p>
      </section>
    </div>
  );
}
