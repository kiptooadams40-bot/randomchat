"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

type State = "checking" | "paid" | "pending" | "failed" | "review" | "error";

const POLL_MS = 3000;
const MAX_POLLS = 40; // ~2 minutes: M-Pesa approvals can take a moment

/** PesaPal sends the customer back here. We verify the payment server-side (never trusting the URL). */
function Success() {
  const ref = useSearchParams().get("ref");
  const [state, setState] = useState<State>(ref ? "checking" : "error");
  const [product, setProduct] = useState<string | null>(null);
  const polls = useRef(0);

  useEffect(() => {
    if (!ref) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        const r = await fetch(`/api/billing/confirm?ref=${encodeURIComponent(ref!)}`, { cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (stop) return;
        if (d?.product) setProduct(d.product);
        if (d?.status === "completed") return setState("paid");
        if (d?.status === "failed" || d?.status === "reversed") return setState("failed");
        if (d?.status === "review") return setState("review");
        if (r.status === 404) return setState("error");
        if (++polls.current >= MAX_POLLS) return setState("pending");
        setState("checking");
      } catch {
        if (stop) return;
        if (++polls.current >= MAX_POLLS) return setState("pending");
      }
      timer = setTimeout(check, POLL_MS);
    }
    void check();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ref]);

  const vip = product === "vip24";
  return (
    <div className="max-w-md space-y-4" aria-live="polite">
      {state === "checking" && (
        <>
          <h1 className="text-2xl font-bold">Confirming your payment…</h1>
          <p className="text-neutral-400">If you&apos;re paying with M-Pesa, approve the prompt on your phone. This page updates by itself.</p>
        </>
      )}
      {state === "paid" && (
        <>
          <h1 className="text-3xl font-bold">{vip ? "VIP pass unlocked ⚡" : "You're Premium 🎉"}</h1>
          <p className="text-neutral-400">{vip ? "Unlimited, unblurred chat for the next 24 hours." : "Unlimited matches and filters are now active."}</p>
          <Link href="/chat" className="inline-block rounded-full bg-violet-600 px-5 py-2 font-medium hover:bg-violet-500">
            Start chatting
          </Link>
        </>
      )}
      {state === "pending" && (
        <p className="text-neutral-300">
          We haven&apos;t received confirmation yet. If you completed the payment, it will activate automatically within a few minutes. Check your{" "}
          <Link href="/account" className="underline">account</Link>.
        </p>
      )}
      {state === "failed" && (
        <>
          <h1 className="text-2xl font-bold">Payment not completed</h1>
          <p className="text-neutral-400">You weren&apos;t charged for this attempt. You can try again any time.</p>
          <Link href="/pricing" className="inline-block rounded-full bg-violet-600 px-5 py-2 font-medium hover:bg-violet-500">
            Back to Premium
          </Link>
        </>
      )}
      {state === "review" && (
        <>
          <h1 className="text-2xl font-bold">We received your payment</h1>
          <p className="text-neutral-400">
            We couldn&apos;t match it to your order automatically. You have not lost your money: contact support with your PesaPal receipt and we&apos;ll activate your access.
          </p>
        </>
      )}
      {state === "error" && (
        <p className="text-red-300">
          We couldn&apos;t find that order. If you were charged, contact support with your PesaPal receipt, or check your{" "}
          <Link href="/account" className="underline">account</Link>.
        </p>
      )}
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense>
      <Success />
    </Suspense>
  );
}
