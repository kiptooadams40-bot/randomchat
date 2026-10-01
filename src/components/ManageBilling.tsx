"use client";

import { useState } from "react";

/** Opens the Stripe Customer Portal so subscribers can cancel or change payment method. */
export default function ManageBilling() {
  const [msg, setMsg] = useState<string | null>(null);

  async function open() {
    setMsg(null);
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.location.href = data.url;
    else setMsg("No active card subscription found for this browser session.");
  }

  return (
    <div>
      <button onClick={open} className="rounded-full border border-white/20 px-5 py-2 text-sm hover:bg-white/5">
        Manage or cancel subscription
      </button>
      {msg && <p className="mt-2 text-xs text-neutral-400">{msg}</p>}
    </div>
  );
}
