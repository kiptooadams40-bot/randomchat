"use client";

import { useEffect, useState } from "react";
import { startCheckout } from "@/lib/checkout-client";
import { VIP_PASS, formatKes, formatPrice, quote, type PayMethod } from "@/lib/plans";
import MethodToggle from "./MethodToggle";

/**
 * Flash deal shown only from the blur paywalls. Not linked from the Premium store.
 * Card: USD $0.55. M-Pesa: KES 70. Both are paid on PesaPal's hosted page.
 */
export default function FlashDealModal({ reason, onClose }: { reason: "tease" | "location"; onClose: () => void }) {
  const [method, setMethod] = useState<PayMethod>("mpesa");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = quote(VIP_PASS.id, method);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pay() {
    setBusy(true);
    setError(null);
    const err = await startCheckout(VIP_PASS.id, method); // navigates to PesaPal on success
    if (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="w-full max-w-md rounded-3xl border border-amber-400/60 bg-neutral-950 p-6 shadow-2xl shadow-amber-900/30">
        <p className="text-sm font-bold uppercase tracking-wide text-amber-400">⚡ Flash deal</p>
        <h2 id="deal-title" className="mt-1 text-3xl font-extrabold">
          {reason === "tease" ? "The stranger is still waiting!" : "Your match is ready!"}
        </h2>
        <p className="mt-2 text-neutral-300">
          Unlock the {VIP_PASS.name} to {reason === "tease" ? "reconnect instantly" : "see them now"}.
        </p>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
          <span className="text-5xl font-extrabold text-amber-300">{q.display}</span>
          <span className="text-sm text-neutral-400">
            {method === "card" ? "USD" : `≈ ${formatPrice(VIP_PASS.priceCents)} USD`} · one-time · {VIP_PASS.hours} hours
          </span>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-neutral-200">
          <li>✅ Remove the blur and keep chatting</li>
          <li>✅ Unlimited time on every match for {VIP_PASS.hours}h</li>
          <li>✅ Location filter fully unlocked</li>
          <li>✅ No subscription, nothing renews</li>
        </ul>

        <div className="mt-5">
          <MethodToggle value={method} onChange={setMethod} disabled={busy} />
        </div>
        <button
          onClick={pay}
          disabled={busy}
          className="mt-3 w-full rounded-full bg-amber-400 py-3 text-lg font-extrabold text-black hover:bg-amber-300 disabled:opacity-60"
        >
          {busy ? "Redirecting to PesaPal…" : method === "mpesa" ? `Pay ${formatKes(VIP_PASS.kes)} with M-Pesa` : `Pay ${formatPrice(VIP_PASS.priceCents)} by card`}
        </button>
        <p className="mt-2 text-center text-xs text-neutral-500">
          You&apos;ll finish on PesaPal&apos;s secure page, then come straight back.
        </p>

        {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
        <button onClick={onClose} className="mt-4 w-full text-center text-xs text-neutral-500 underline">
          No thanks, keep it blurred
        </button>
      </div>
    </div>
  );
}
