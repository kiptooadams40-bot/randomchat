"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export const CONSENT_KEY = "rc_consent";
export const CONSENT_EVENT = "rc-consent-change";

export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(!localStorage.getItem(CONSENT_KEY));
    } catch {
      setShow(true);
    }
  }, []);

  function choose(value: "accepted" | "declined") {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch {
      /* storage blocked: choice lasts for this page view only */
    }
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
    setShow(false);
  }

  if (!show) return null;
  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-neutral-950/95 p-4 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-neutral-300">
          We use essential cookies to run the site. With your consent we also use analytics cookies to improve it.
          No tracking runs until you accept. See our <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
        <div className="flex gap-2">
          <button onClick={() => choose("declined")} className="rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5">
            Decline
          </button>
          <button onClick={() => choose("accepted")} className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
