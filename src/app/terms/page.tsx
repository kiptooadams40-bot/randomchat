import Link from "next/link";
import { FREE_MATCHES, TEASE_SECONDS } from "@/lib/plans";

export const metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <article className="max-w-2xl space-y-4 text-sm leading-relaxed text-neutral-300">
      <h1 className="text-3xl font-bold text-white">Terms of Service &amp; Safety</h1>
      <p className="text-neutral-500">Last updated: 2026-09-30. Template text: have it reviewed by a lawyer before launch.</p>

      <h2 className="pt-2 text-lg font-semibold text-white">Eligibility</h2>
      <p>You must be 18 or older. By using RandomChat you confirm that you are.</p>

      <h2 className="pt-2 text-lg font-semibold text-white">Acceptable use</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>No nudity, sexual content, harassment, hate, threats, or illegal activity.</li>
        <li>No recording or sharing of other users&apos; video, audio or messages without consent.</li>
        <li>No spam, advertising, or attempts to bypass limits, filters, payments or the referral programme (including self-referral and fake sign-ups).</li>
        <li>Never share personal information such as your address, school, or passwords.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold text-white">Free tier</h2>
      <p>
        The first {FREE_MATCHES} matches are free. Afterwards, the other person&apos;s video is shown clearly for {TEASE_SECONDS} seconds
        and then blurred unless you hold an active VIP Pass or Premium subscription. Location matches for free users are blurred from the start.
      </p>

      <h2 className="pt-2 text-lg font-semibold text-white">VIP Pass</h2>
      <p>
        The 24-Hour VIP Pass is a one-time purchase, priced in US dollars, that removes blur and time limits and unlocks the location filter for 24 hours.
        It does not renew. Payments by card are processed by Stripe; M-Pesa is offered where available.
      </p>

      <h2 className="pt-2 text-lg font-semibold text-white">Premium plans</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Premium comes in weekly, fortnightly and monthly durations at the same price either way. For each plan you choose how to pay: <strong>Recurring Billing</strong>, an auto-renewing subscription that renews at the price shown until you cancel, or a <strong>One-Time Payment</strong>, a single charge for that duration that never renews.</li>
        <li>Cancel a recurring subscription any time under Account, Manage or cancel subscription. Access continues until the end of the paid period; we don&apos;t refund partial periods unless required by law. One-time payments have nothing to cancel and end on their expiry date.</li>
        <li>Premium includes the Boys / Girls / Both gender filter, which matches you only with people who have chosen to share their gender.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold text-white">Referral rewards</h2>
      <p>Rewards (extra free matches and VIP time) have no cash value, are granted automatically, and may be withdrawn if we detect abuse.</p>

      <h2 className="pt-2 text-lg font-semibold text-white">Moderation</h2>
      <p>Use the Report button on anyone who breaks these rules. We may suspend access at our discretion.</p>

      <h2 className="pt-2 text-lg font-semibold text-white">Disclaimer</h2>
      <p>RandomChat connects strangers and cannot guarantee their behaviour. The service is provided &quot;as is&quot;. See our <Link href="/privacy" className="underline">Privacy Policy</Link> for how data is handled.</p>
    </article>
  );
}
