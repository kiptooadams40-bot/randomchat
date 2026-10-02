import Link from "next/link";
import { FREE_MATCHES, REFERRAL, TEASE_SECONDS } from "@/lib/plans";

export const metadata = { title: "FAQ" };

const FAQ: [string, string][] = [
  ["Is RandomChat free?", `Your first ${FREE_MATCHES} matches are completely free. From the ${FREE_MATCHES + 1}th match you get ${TEASE_SECONDS} seconds of clear video, then the stranger's video is blurred until you unlock access. Premium removes the limit.`],
  ["What is the VIP Pass?", "A one-time, 24-hour pass offered when your video is blurred. It removes the blur, lifts the time limit and unlocks the location filter for 24 hours. It is a one-time payment, does not renew and does not include the gender filter."],
  ["What does Premium include?", "Weekly (7 days), Fortnightly (14 days) or Monthly (30 days) access with unlimited chat time, no blur, the location filter, and the Boys / Girls / Both filter. Each is a one-time payment: nothing renews automatically, and buying again adds time on top of what you have left."],
  ["Is there anything to cancel?", "No. Premium and the VIP Pass are one-time payments, so there is no subscription and no automatic renewal. Your access simply ends on its expiry date."],
  ["How does the location filter work?", "Pick the country you want to meet people from. Free users are matched with real people from that region, but their video is blurred until they unlock a VIP pass or Premium. Matching relies on the country people choose for themselves."],
  ["How can I pay?", "By card or M-Pesa, on PesaPal's secure checkout page. Cards are charged in USD (VIP Pass $0.55, Weekly $4.99, Fortnightly $8.99, Monthly $14.99). M-Pesa is charged in KES (VIP Pass KES 70, Weekly KES 650, Fortnightly KES 1,170, Monthly KES 1,950)."],
  ["How do referrals work?", `Share your invite link. Each friend who confirms they're 18+ and connects to a chat counts. ${REFERRAL.tier1.referrals} referrals earns ${REFERRAL.tier1.bonusMatches} extra free matches, ${REFERRAL.tier2.referrals} earns ${REFERRAL.tier2.bonusMatches} more. If ${REFERRAL.engagement.users} of your referred friends are active for over ${REFERRAL.engagement.minutes} minutes, you get a ${REFERRAL.engagement.vipHours}-hour VIP pass. It starts the moment it is awarded and ends exactly ${REFERRAL.engagement.vipHours} hour later on the clock, whether or not you are online or chatting. Self-referrals and duplicate sign-ups don't count.`],
  ["Who can use it?", "Adults aged 18 and over only. You'll be asked to confirm your age before chatting."],
  ["Do you record my video?", "No. Video and audio go directly between you and the other person (peer-to-peer). We don't record or store them."],
  ["Why can't I connect to some people?", "Some networks (strict firewalls, mobile carriers) block direct connections. Try Wi-Fi or press Next."],
  ["How does translation work?", "Turn on Translate in the chat box and pick English, French or Spanish. Text messages are sent to a third-party translation service. Video and audio are not translated."],
  ["How do I report someone?", "Press Report during a chat and pick a reason. You're disconnected immediately."],
  ["Which cookies do you use?", "Essential cookies keep your session and remember who invited you. Analytics cookies are only used if you accept them in the cookie banner."],
];

export default function FaqPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold">Frequently asked questions</h1>
      <div className="space-y-3">
        {FAQ.map(([q, a]) => (
          <details key={q} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <summary className="cursor-pointer font-medium">{q}</summary>
            <p className="mt-2 text-sm text-neutral-300">{a}</p>
          </details>
        ))}
      </div>
      <Link href="/chat" className="inline-block rounded-full bg-violet-600 px-6 py-2.5 font-medium hover:bg-violet-500">
        Start chatting
      </Link>
    </div>
  );
}
