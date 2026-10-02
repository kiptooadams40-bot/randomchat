"use client";

import { useState } from "react";
import { startCheckout } from "@/lib/checkout-client";
import { PLANS, formatKes, formatPrice, quote, type PayMethod, type PlanId } from "@/lib/plans";
import MethodToggle from "./MethodToggle";

export default function PricingCards() {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Record<PlanId, PayMethod>>({ weekly: "card", fortnightly: "card", monthly: "card" });

  async function pay(plan: PlanId) {
    setBusy(plan);
    setError(null);
    const err = await startCheckout(plan, method[plan]); // navigates to PesaPal on success
    if (err) {
      setError(err);
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((p) => {
          const q = quote(p.id, method[p.id]);
          return (
            <div
              key={p.id}
              className={`flex flex-col rounded-2xl border p-5 ${
                p.id === "monthly" ? "border-violet-500 bg-violet-950/30" : "border-white/10 bg-neutral-900/60"
              }`}
            >
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-3xl font-bold">{q.display}</p>
              <p className="text-sm text-neutral-400">
                {method[p.id] === "card" ? `or ${formatKes(p.kes)} via M-Pesa` : `or ${formatPrice(p.priceCents)} by card`} · {p.days} days
              </p>
              <ul className="mt-3 flex-1 space-y-1 text-sm text-neutral-300">
                <li>✓ Boys / Girls / Both filter</li>
                <li>✓ Unlimited chat time, no blur</li>
                <li>✓ Location filter</li>
              </ul>
              <div className="mt-4">
                <MethodToggle
                  value={method[p.id]}
                  onChange={(m) => setMethod((s) => ({ ...s, [p.id]: m }))}
                  disabled={busy !== null}
                  label={`${p.name} payment method`}
                />
              </div>
              <button
                onClick={() => pay(p.id)}
                disabled={busy !== null}
                className="mt-4 rounded-full bg-violet-600 py-2 font-medium hover:bg-violet-500 disabled:opacity-50"
              >
                {busy === p.id ? "Redirecting to PesaPal…" : `Pay ${q.display}`}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
      <p className="mt-4 text-xs text-neutral-500">
        Secure checkout by PesaPal. Cards are charged in USD and M-Pesa in KES. One-time payments: nothing renews automatically.
      </p>
    </div>
  );
}
