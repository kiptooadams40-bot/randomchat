"use client";

import { useState } from "react";

/** `onVerified` must re-check with the server and resolve to whether it really stuck. */
export default function AgeGate({ onVerified }: { onVerified: () => Promise<boolean> }) {
  const [birthDate, setBirthDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/age/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birthDate }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? "Verification failed.");
      return;
    }
    // Don't trust the optimistic path: confirm the server actually remembered it.
    const stuck = await onVerified();
    setBusy(false);
    if (!stuck) setError("We couldn't save your verification. Make sure cookies are enabled for this site, then try again.");
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-6">
      <h2 className="text-xl font-semibold">Are you 18 or older?</h2>
      <p className="text-sm text-neutral-400">
        RandomChat is for adults only. Enter your date of birth to continue.
        {process.env.NEXT_PUBLIC_APP_ENV !== "production" && (
          <span className="block text-amber-400">Dev mode: self-declared check (mock provider).</span>
        )}
      </p>
      <input
        type="date"
        required
        value={birthDate}
        onChange={(e) => setBirthDate(e.target.value)}
        max={new Date().toISOString().slice(0, 10)}
        className="w-full rounded-lg bg-neutral-800 px-3 py-2"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button disabled={busy || !birthDate} className="w-full rounded-full bg-violet-600 py-2 font-medium disabled:opacity-40">
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
