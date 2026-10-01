"use client";

import { useEffect, useRef, useState } from "react";
import { startCheckout } from "@/lib/checkout-client";
import { VIP_PASS, formatPrice } from "@/lib/plans";

type Tab = "mpesa" | "card";
type Stage = "form" | "waiting" | "error";

/**
 * Flash deal shown only from the blur paywalls. Not linked from the Premium
 * store. Price is always shown in USD. M-Pesa is a SIMULATION in test mode.
 */
export default function FlashDealModal({
  reason,
  onPaid,
  onClose,
}: {
  reason: "tease" | "location";
  onPaid: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("mpesa");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [cardPending, setCardPending] = useState(false);
  const stkId = useRef<string | null>(null);
  const price = formatPrice(VIP_PASS.priceCents);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Poll for the unlock: M-Pesa status, or the session when paying by card in another tab.
  useEffect(() => {
    if (stage !== "waiting" && !cardPending) return;
    const i = setInterval(async () => {
      try {
        if (stkId.current) {
          const r = await fetch(`/api/billing/mpesa/status?id=${stkId.current}`, { cache: "no-store" });
          if ((await r.json()).status === "paid") return onPaid();
        }
        if (cardPending) {
          const r = await fetch("/api/session", { cache: "no-store" });
          const s = await r.json();
          if (s.vip || s.premium) onPaid();
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => clearInterval(i);
  }, [stage, cardPending, onPaid]);

  async function payMpesa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/billing/mpesa/stk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.replace(/[\s-]/g, "") }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      stkId.current = data.id;
      setStage("waiting");
    } else {
      setError(data.error === "bad_phone" ? "Enter a valid Kenyan number, e.g. 0712 345 678." : "M-Pesa is unavailable right now. Try card.");
    }
  }

  async function payCard() {
    setError(null);
    if (await startCheckout(VIP_PASS.id, { newTab: true })) setCardPending(true);
    else setError("Card payments are unavailable right now.");
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

        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-5xl font-extrabold text-amber-300">{price}</span>
          <span className="text-sm text-neutral-400">USD · one-time · {VIP_PASS.hours} hours</span>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-neutral-200">
          <li>✅ Remove the blur and keep this chat going</li>
          <li>✅ Unlimited time on every match for {VIP_PASS.hours}h</li>
          <li>✅ Location filter fully unlocked</li>
          <li>✅ No subscription, nothing renews</li>
        </ul>

        {stage === "waiting" ? (
          <div className="mt-5 rounded-2xl bg-neutral-900 p-4 text-center" aria-live="polite">
            <p className="animate-pulse font-semibold">Check your phone…</p>
            <p className="mt-1 text-sm text-neutral-400">Enter your M-Pesa PIN to approve {price}.</p>
            <p className="mt-2 text-xs text-amber-400">Test mode: this M-Pesa prompt is simulated. No money moves.</p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-full bg-neutral-900 p-1 text-sm" role="tablist">
              {(["mpesa", "card"] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`rounded-full py-1.5 font-medium ${tab === t ? "bg-amber-400 text-black" : "text-neutral-300"}`}
                >
                  {t === "mpesa" ? "M-Pesa" : "Card"}
                </button>
              ))}
            </div>

            {tab === "mpesa" ? (
              <form onSubmit={payMpesa} className="mt-3 space-y-2">
                <label className="block text-xs text-neutral-400" htmlFor="mpesa-phone">
                  M-Pesa phone number
                </label>
                <input
                  id="mpesa-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  className="w-full rounded-xl bg-neutral-800 px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-amber-400"
                />
                <button className="w-full rounded-full bg-amber-400 py-3 text-lg font-extrabold text-black hover:bg-amber-300">
                  Pay {price} with M-Pesa
                </button>
              </form>
            ) : (
              <div className="mt-3 space-y-2">
                <button
                  onClick={payCard}
                  disabled={cardPending}
                  className="w-full rounded-full bg-amber-400 py-3 text-lg font-extrabold text-black hover:bg-amber-300 disabled:opacity-60"
                >
                  {cardPending ? "Waiting for payment…" : `Pay ${price} with card`}
                </button>
                <p className="text-center text-xs text-neutral-500">
                  Opens secure checkout in a new tab. Come back here and this chat unblurs automatically.
                </p>
              </div>
            )}
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <button onClick={onClose} className="mt-4 w-full text-center text-xs text-neutral-500 underline">
          No thanks, keep it blurred
        </button>
      </div>
    </div>
  );
}
