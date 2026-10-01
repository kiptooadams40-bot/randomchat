"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { startCheckout } from "@/lib/checkout-client";
import { PLANS, formatPrice, type Billing, type PlanId } from "@/lib/plans";
import BillingToggle from "./BillingToggle";

/** Premium upsell, shown when a free user tries the Boys / Girls filter. */
export default function PaywallModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanId>("monthly");
  const [billing, setBilling] = useState<Billing>("recurring");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = PLANS.find((p) => p.id === plan)!;

  async function buy() {
    setBusy(plan);
    setError(null);
    if (!(await startCheckout(plan, { billing }))) {
      setError("Payments are unavailable right now. Please try again shortly.");
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="w-full max-w-lg rounded-3xl border border-violet-500/50 bg-neutral-950 p-6 shadow-2xl shadow-violet-900/40">
        <p className="text-sm font-semibold uppercase tracking-wide text-violet-300">🔒 Premium feature</p>
        <h2 id="paywall-title" className="mt-1 text-3xl font-extrabold">Choose who you meet.</h2>
        <p className="mt-2 text-neutral-300">
          The Boys / Girls filter is for Premium members. Pick a plan and how you want to pay.
        </p>

        <ul className="mt-4 space-y-1 text-sm text-neutral-200">
          <li>✅ Boys / Girls / Both filter</li>
          <li>✅ Unlimited time on every match, never blurred</li>
          <li>✅ Location filter included</li>
        </ul>

        <div className="mt-5 space-y-2" role="radiogroup" aria-label="Plan">
          {[...PLANS].reverse().map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={plan === p.id}
              onClick={() => setPlan(p.id)}
              disabled={busy !== null}
              className={`flex w-full items-center justify-between rounded-2xl border px-5 py-3 text-left font-semibold transition disabled:opacity-60 ${
                plan === p.id ? "border-violet-500 bg-violet-950/50" : "border-transparent bg-neutral-800 hover:bg-neutral-700"
              }`}
            >
              <span>
                {p.name}
                <span className="block text-xs font-normal text-neutral-300">{p.days} days</span>
              </span>
              <span>{formatPrice(p.priceCents)}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <BillingToggle plan={selected} value={billing} onChange={setBilling} disabled={busy !== null} />
        </div>

        <button
          onClick={buy}
          disabled={busy !== null}
          className="mt-4 w-full rounded-full bg-violet-600 py-3 text-lg font-extrabold hover:bg-violet-500 disabled:opacity-60"
        >
          {busy
            ? "Redirecting…"
            : billing === "recurring"
              ? `Subscribe · ${formatPrice(selected.priceCents)}`
              : `Pay once · ${formatPrice(selected.priceCents)}`}
        </button>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <p className="mt-3 text-center text-xs text-neutral-500">
          By purchasing you agree to the <Link href="/terms" className="underline">Terms</Link>.
        </p>
        <button onClick={onClose} className="mt-2 w-full text-center text-xs text-neutral-500 underline">
          No thanks, maybe later
        </button>
      </div>
    </div>
  );
}
