"use client";

import { useState } from "react";
import { startCheckout } from "@/lib/checkout-client";
import { PLANS, formatPrice, type Billing, type PlanId } from "@/lib/plans";
import BillingToggle from "./BillingToggle";

export default function PricingCards() {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<Record<PlanId, Billing>>({
    weekly: "recurring",
    fortnightly: "recurring",
    monthly: "recurring",
  });

  async function buy(plan: PlanId) {
    setBusy(plan);
    setError(null);
    if (!(await startCheckout(plan, { billing: billing[plan] }))) {
      setError("Payments are unavailable right now.");
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className={`flex flex-col rounded-2xl border p-5 ${
              p.id === "monthly" ? "border-violet-500 bg-violet-950/30" : "border-white/10 bg-neutral-900/60"
            }`}
          >
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <p className="mt-1 text-3xl font-bold">{formatPrice(p.priceCents)}</p>
            <p className="text-sm text-neutral-400">USD · {p.days} days of Premium</p>
            <ul className="mt-3 flex-1 space-y-1 text-sm text-neutral-300">
              <li>✓ Boys / Girls / Both filter</li>
              <li>✓ Unlimited chat time, no blur</li>
              <li>✓ Location filter</li>
            </ul>
            <div className="mt-4">
              <BillingToggle
                plan={p}
                value={billing[p.id]}
                onChange={(b) => setBilling((s) => ({ ...s, [p.id]: b }))}
                disabled={busy !== null}
              />
            </div>
            <button
              onClick={() => buy(p.id)}
              disabled={busy !== null}
              className="mt-4 rounded-full bg-violet-600 py-2 font-medium hover:bg-violet-500 disabled:opacity-50"
            >
              {busy === p.id
                ? "Redirecting…"
                : billing[p.id] === "recurring"
                  ? `Subscribe · ${formatPrice(p.priceCents)}`
                  : `Pay once · ${formatPrice(p.priceCents)}`}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-4 text-xs text-neutral-500">
        Same price either way. Recurring subscriptions can be cancelled anytime from your account. Test mode: card 4242
        4242 4242 4242, any future date and CVC. No real charges.
      </p>
    </div>
  );
}
