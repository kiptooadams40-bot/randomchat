import Link from "next/link";
import ManageBilling from "@/components/ManageBilling";
import { FREE_MATCHES, getPlan } from "@/lib/plans";
import { peekUser } from "@/lib/session";
import { isPremium, isVip } from "@/lib/entitlements";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

export default async function AccountPage() {
  const u = await peekUser();
  const premium = !!u && isPremium(u);
  const vip = !!u && isVip(u);
  const plan = getPlan(u?.plan);
  const recurring = u?.planBilling !== "once";

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-3xl font-bold">Account</h1>
      <div className="space-y-2 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 text-sm">
        <Row k="Age verified" v={u?.ageVerified ? "Yes" : "No"} />
        <Row k="Plan" v={premium ? `Premium (${plan?.name})` : "Free"} />
        {premium && <Row k="Payment" v={recurring ? "Recurring billing" : "One-time payment"} />}
        {premium && u?.planExpiresAt && (
          <Row k={recurring ? "Current period ends" : "Premium ends"} v={new Date(u.planExpiresAt).toLocaleDateString()} />
        )}
        {vip && u?.vipUntil && <Row k="VIP pass until" v={new Date(u.vipUntil).toLocaleString()} />}
        {!premium && (
          <Row k="Free matches used" v={`${Math.min(u?.matchesTotal ?? 0, FREE_MATCHES + (u?.bonusMatches ?? 0))} / ${FREE_MATCHES + (u?.bonusMatches ?? 0)}`} />
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/pricing" className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium hover:bg-violet-500">
          {premium ? "Change plan" : "Go Premium"}
        </Link>
        <Link href="/invite" className="rounded-full border border-white/20 px-5 py-2 text-sm hover:bg-white/5">
          Invite friends
        </Link>
      </div>
      {premium && recurring && <ManageBilling />}
      {premium && !recurring && (
        <p className="text-xs text-neutral-500">One-time payment: nothing renews. Buy again anytime to extend.</p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-400">{k}</span>
      <span>{v}</span>
    </div>
  );
}
