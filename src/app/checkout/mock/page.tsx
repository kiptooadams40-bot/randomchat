"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { VIP_PASS, formatPrice, getPlan } from "@/lib/plans";

function MockCheckout() {
  const params = useSearchParams();
  const product = params.get("product");
  const billing = params.get("billing") === "once" ? "once" : "recurring";
  const vip = product === VIP_PASS.id;
  const plan = getPlan(product);
  const [busy, setBusy] = useState(false);
  if (!vip && !plan) return <p>Unknown product.</p>;

  const name = vip ? VIP_PASS.name : `${plan!.name} Premium (${billing === "once" ? "one-time payment" : "recurring billing"})`;
  const price = formatPrice(vip ? VIP_PASS.priceCents : plan!.priceCents);

  async function pay() {
    setBusy(true);
    const res = await fetch("/api/billing/mock-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, billing }),
    });
    if (res.ok) window.location.href = `/checkout/success?product=${product}`;
    else setBusy(false);
  }

  return (
    <div className="max-w-md space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-6">
      <p className="text-xs uppercase text-amber-400">Mock checkout · dev only · no real payment</p>
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="text-3xl font-bold">{price} <span className="text-sm font-normal text-neutral-400">USD</span></p>
      {plan && (
        <p className="text-sm text-neutral-400">
          {billing === "once" ? `Charged once for ${plan.days} days. No renewal.` : `${plan.blurb}. Renews until cancelled.`}
        </p>
      )}
      <button onClick={pay} disabled={busy} className="w-full rounded-full bg-violet-600 py-2 font-medium disabled:opacity-50">
        {busy ? "Processing…" : `Pay ${price} (mock)`}
      </button>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense>
      <MockCheckout />
    </Suspense>
  );
}
