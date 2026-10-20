"use client";

import { useEffect, useRef, useState } from "react";

const SKIP_KEY = "rc_skip_signin_before_pay";

async function post(url: string, body: unknown) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { message: "Network error. Check your connection and try again." } };
  }
}

/**
 * Email + 6-digit code sign-in. A code (not a magic link) keeps the person in the browser
 * they're already using, including Instagram / WhatsApp in-app browsers.
 */
export function SignInForm({ onDone }: { onDone: (r: { merged: boolean }) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/auth/code", { email });
    setBusy(false);
    if (!r.ok) return setError(r.data.message ?? "We couldn't send the code. Please try again.");
    setStep("code");
    setCode("");
    setResendIn(60);
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function verify(value = code) {
    if (!/^\d{6}$/.test(value) || busy) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/auth/verify", { email, code: value });
    setBusy(false);
    if (!r.ok) {
      setCode("");
      return setError(r.data.message ?? "That code didn't work. Try again.");
    }
    onDone({ merged: !!r.data.merged });
  }

  const input = "w-full rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-violet-500";

  if (step === "email") {
    return (
      <form onSubmit={sendCode} className="space-y-3">
        <label className="block text-sm text-neutral-300">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={`${input} mt-1`}
          />
        </label>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <button disabled={busy || !email} className="w-full rounded-full bg-violet-600 py-2 font-medium hover:bg-violet-500 disabled:opacity-50">
          {busy ? "Sending…" : "Email me a 6-digit code"}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
      className="space-y-3"
    >
      <p className="text-sm text-neutral-300">
        We sent a 6-digit code to <span className="font-medium text-white">{email}</span>. It may take a minute; check spam too.
      </p>
      <input
        ref={codeRef}
        value={code}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(v);
          if (v.length === 6) void verify(v);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        aria-label="6-digit code"
        placeholder="123456"
        className={`${input} text-center text-2xl tracking-[0.5em]`}
      />
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      <button disabled={busy || code.length !== 6} className="w-full rounded-full bg-violet-600 py-2 font-medium hover:bg-violet-500 disabled:opacity-50">
        {busy ? "Checking…" : "Sign in"}
      </button>
      <div className="flex justify-between text-xs text-neutral-400">
        <button type="button" onClick={() => setStep("email")} className="underline">Use a different email</button>
        <button type="button" disabled={resendIn > 0 || busy} onClick={() => void sendCode()} className="underline disabled:no-underline disabled:opacity-60">
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}

export function SignInModal({
  title,
  subtitle,
  skipLabel = "Not now",
  onDone,
  onSkip,
}: {
  title: string;
  subtitle?: string;
  skipLabel?: string;
  onDone: (r: { merged: boolean }) => void;
  onSkip: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSkip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="signin-title" className="fixed inset-0 z-[55] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-sm space-y-4 rounded-3xl border border-white/10 bg-neutral-950 p-6 shadow-2xl">
        <div>
          <h2 id="signin-title" className="text-xl font-bold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
        </div>
        <SignInForm onDone={onDone} />
        <button onClick={onSkip} className="w-full text-center text-xs text-neutral-500 underline">{skipLabel}</button>
      </div>
    </div>
  );
}

/**
 * Before paying: anonymous visitors are asked to sign in so Premium follows them to every
 * device. They can skip (remembered for this browser tab session).
 */
export function useSignInBeforePay() {
  const [pending, setPending] = useState<(() => void) | null>(null);

  async function guard(run: () => void) {
    let skipped = false;
    try {
      skipped = sessionStorage.getItem(SKIP_KEY) === "1";
    } catch {
      /* storage blocked */
    }
    const s = skipped ? null : await fetch("/api/session", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (skipped || !s || s.signedIn) return run();
    setPending(() => run);
  }

  const finish = (skip: boolean) => {
    if (skip) {
      try {
        sessionStorage.setItem(SKIP_KEY, "1");
      } catch {
        /* storage blocked */
      }
    }
    const run = pending;
    setPending(null);
    run?.();
  };

  const modal = pending ? (
    <SignInModal
      title="Sign in so Premium works on all your devices"
      subtitle="Takes 30 seconds: we email you a 6-digit code. No password."
      skipLabel="Continue without signing in"
      onDone={() => finish(false)}
      onSkip={() => finish(true)}
    />
  ) : null;

  return { guard, modal };
}
