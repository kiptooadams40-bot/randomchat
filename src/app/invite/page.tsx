"use client";

import { useEffect, useState } from "react";
import { REFERRAL } from "@/lib/plans";

type Data = {
  link: string;
  referrals: number;
  engaged: number;
  bonusMatches: number;
  vip: boolean;
  awarded: { tier1: boolean; tier2: boolean; engagement: boolean };
};

function Bar({ value, max, label, done }: { value: number; max: number; label: string; done: boolean }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label} {done && "✅"}</span>
        <span className="text-neutral-400">{Math.min(value, max)} / {max}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function InvitePage() {
  const [d, setD] = useState<Data | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/referral", { cache: "no-store" }).then((r) => r.json()).then(setD);
  }, []);

  async function copy() {
    if (!d) return;
    try {
      await navigator.clipboard.writeText(d.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is selectable in the box */
    }
  }

  const m = REFERRAL;
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Invite friends, earn rewards</h1>
        <p className="mt-2 text-neutral-400">
          Share your link. A referral counts once your friend confirms they&apos;re 18+ and connects to their first chat.
        </p>
      </div>

      <div className="flex gap-2">
        <input readOnly value={d?.link ?? "Loading…"} aria-label="Your referral link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm" />
        <button onClick={copy} disabled={!d} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:opacity-50">
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      {d && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-5">
          <Bar value={d.referrals} max={m.tier1.referrals} done={d.awarded.tier1} label={`${m.tier1.referrals} referrals → +${m.tier1.bonusMatches} free matches`} />
          <Bar value={d.referrals} max={m.tier2.referrals} done={d.awarded.tier2} label={`${m.tier2.referrals} referrals → +${m.tier2.bonusMatches} more free matches`} />
          <Bar value={d.engaged} max={m.engagement.users} done={d.awarded.engagement} label={`${m.engagement.users} friends active ${m.engagement.minutes}+ min → ${m.engagement.vipHours}-Hour VIP Pass`} />
          <p className="text-xs text-neutral-500">
            Bonus matches earned so far: {d.bonusMatches}. Rewards unlock automatically. The VIP pass starts the moment it is awarded and runs on a fixed 1-hour clock, whether or not you are online.
            {d.vip && " Your VIP pass is active right now."}
          </p>
        </div>
      )}
    </div>
  );
}
