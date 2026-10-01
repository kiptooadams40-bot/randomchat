"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function Success() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const vip = params.get("product") === "vip24";
  const [state, setState] = useState<"checking" | "ok" | "failed">(sessionId ? "checking" : "ok");

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => setState(r.ok ? "ok" : "failed"))
      .catch(() => setState("failed"));
  }, [sessionId]);

  return (
    <div className="max-w-md space-y-4">
      {state === "checking" && <p>Confirming your payment…</p>}
      {state === "ok" && (
        <>
          <h1 className="text-3xl font-bold">{vip ? "VIP pass unlocked ⚡" : "You're Premium 🎉"}</h1>
          <p className="text-neutral-400">
            {vip
              ? "If you left a chat open in another tab, switch back: it unblurs automatically."
              : "Unlimited matches and filters are now active."}
          </p>
          <Link href="/chat" className="inline-block rounded-full bg-violet-600 px-5 py-2 font-medium">
            Start chatting
          </Link>
        </>
      )}
      {state === "failed" && (
        <p className="text-red-300">
          We couldn&apos;t confirm the payment. If you were charged, it will activate shortly; check your{" "}
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
