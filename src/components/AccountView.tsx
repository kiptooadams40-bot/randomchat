"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getPlan } from "@/lib/plans";
import { SignInForm } from "./SignIn";

type Device = { device: string; browser: string; lastActive: string; current: boolean };
type Account = {
  signedIn: boolean;
  email: string | null;
  premium: boolean;
  plan: string | null;
  planExpiresAt: number | null;
  vip: boolean;
  vipUntil: number | null;
  matchesUsed: number;
  freeAllowance: number;
  devices: Device[];
};

const when = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "Active now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export default function AccountView() {
  const [a, setA] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/account", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setA(await r.json());
      setError(null);
    } catch {
      setError("We couldn't load your account. Please try again.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: unknown) {
    setBusy(true);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    return !!r?.ok;
  }

  if (error) return <p className="text-red-300">{error}</p>;
  if (!a) return <p className="text-neutral-400">Loading…</p>;

  const plan = getPlan(a.plan);
  const card = "space-y-2 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 text-sm";

  return (
    <div className="max-w-md space-y-5">
      <h1 className="text-3xl font-bold">Account</h1>
      {note && <p className="rounded-lg bg-green-950 p-3 text-sm text-green-200" role="status">{note}</p>}

      {!a.signedIn && (
        <div className={card} id="signin">
          <h2 className="text-base font-semibold">Sign in</h2>
          <p className="text-neutral-400">
            Keep Premium, free matches and invite rewards on every device and browser. We email you a 6-digit code; no password.
            Anything on this browser now is added to your account.
          </p>
          <SignInForm
            onDone={({ merged }) => {
              setNote(merged ? "Signed in. This browser's Premium, matches and rewards were added to your account." : "Signed in.");
              void load();
            }}
          />
        </div>
      )}

      <div className={card}>
        {a.signedIn && <Row k="Email" v={a.email ?? ""} />}
        <Row k="Plan" v={a.premium ? `Premium${plan ? ` (${plan.name})` : ""}` : "Free"} />
        {a.premium && a.planExpiresAt && <Row k="Premium ends" v={new Date(a.planExpiresAt).toLocaleString()} />}
        {a.vip && a.vipUntil && <Row k="VIP pass until" v={new Date(a.vipUntil).toLocaleString()} />}
        {!a.premium && <Row k="Free matches used" v={`${Math.min(a.matchesUsed, a.freeAllowance)} / ${a.freeAllowance}`} />}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/pricing" className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium hover:bg-violet-500">
          {a.premium ? "Add more time" : "Go Premium"}
        </Link>
        <Link href="/invite" className="rounded-full border border-white/20 px-5 py-2 text-sm hover:bg-white/5">Invite friends</Link>
      </div>

      {a.signedIn && (
        <>
          <div className={card}>
            <h2 className="text-base font-semibold">Signed-in devices</h2>
            <ul className="divide-y divide-white/10">
              {a.devices.map((d, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span>
                    {d.device} · {d.browser}
                    {d.current && <span className="ml-2 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold">THIS DEVICE</span>}
                  </span>
                  <span className="shrink-0 text-neutral-400">{when(d.lastActive)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                disabled={busy}
                onClick={async () => {
                  await post("/api/auth/signout", {});
                  setNote("Signed out on this device.");
                  void load();
                }}
                className="rounded-full border border-white/20 px-4 py-1.5 hover:bg-white/5 disabled:opacity-50"
              >
                Sign out
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  await post("/api/auth/signout", { all: true });
                  setNote("Signed out of all devices.");
                  void load();
                }}
                className="rounded-full border border-white/20 px-4 py-1.5 hover:bg-white/5 disabled:opacity-50"
              >
                Sign out of all devices
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-red-500/30 bg-red-950/20 p-5 text-sm">
            <h2 className="text-base font-semibold text-red-200">Delete my account</h2>
            <p className="text-neutral-400">
              This permanently deletes your account, Premium time, matches and invite rewards. Payment records are kept for accounting,
              without your email or account. Type DELETE to confirm.
            </p>
            <input
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              aria-label="Type DELETE to confirm"
              className="w-full rounded-lg bg-neutral-800 px-3 py-2"
            />
            <button
              disabled={busy || confirmDelete !== "DELETE"}
              onClick={async () => {
                if (await post("/api/account/delete", { confirm: "DELETE" })) {
                  setConfirmDelete("");
                  setNote("Your account was deleted.");
                  void load();
                } else setNote("We couldn't delete the account. Please try again.");
              }}
              className="rounded-full bg-red-700 px-4 py-1.5 font-medium hover:bg-red-600 disabled:opacity-40"
            >
              Delete my account
            </button>
          </div>
        </>
      )}
      {a.premium && <p className="text-xs text-neutral-500">One-time payment: nothing renews. Buying again adds time on top of what you have left.</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-neutral-400">{k}</span>
      <span className="truncate">{v}</span>
    </div>
  );
}
