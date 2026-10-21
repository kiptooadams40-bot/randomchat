"use client";

import { useEffect, useState } from "react";
import { inAppBrowser, isAndroid, isIOS } from "@/lib/ua";

const KEY = "rc_inapp_dismissed";

/**
 * Instagram / Facebook / TikTok (and similar) open links in a built-in browser with weaker
 * camera and audio support. Suggest opening the same URL (including any ?ref= invite code)
 * in Chrome or Safari. Dismissible for the rest of the tab session.
 */
export default function InAppBrowserBanner() {
  const [app, setApp] = useState<string | null>(null);
  const [os, setOs] = useState<"android" | "ios" | "other">("other");

  useEffect(() => {
    const ua = navigator.userAgent;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(KEY) === "1";
    } catch {
      /* storage blocked */
    }
    if (dismissed) return;
    setApp(inAppBrowser(ua));
    setOs(isAndroid(ua) ? "android" : isIOS(ua) ? "ios" : "other");
  }, []);

  if (!app) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked */
    }
    setApp(null);
  };

  const openInChrome = () => {
    const { host, pathname, search, hash, href } = window.location;
    // Android intent link: same URL in Chrome; falls back to the normal URL if Chrome is missing.
    window.location.href = `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  };

  return (
    <div role="region" aria-label="Open in your browser" className="relative z-[45] border-b border-amber-400/40 bg-amber-950/90 px-4 py-3 text-sm text-amber-100">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="flex-1 basis-60">
          <span className="font-semibold">For the best camera and sound, open in Chrome or Safari.</span>
          {os === "ios" && (
            <span className="mt-1 block text-amber-200/90">
              Tap the <b>⋯</b> menu (top or bottom right), then <b>Open in browser</b> (or <b>Open in Safari</b>).
            </span>
          )}
          {os === "other" && <span className="mt-1 block text-amber-200/90">Use your app&apos;s menu and choose Open in browser.</span>}
        </p>
        {os === "android" && (
          <button onClick={openInChrome} className="rounded-full bg-amber-400 px-4 py-1.5 font-bold text-black hover:bg-amber-300">
            Open in Chrome
          </button>
        )}
        <button onClick={dismiss} aria-label="Dismiss" className="rounded-full px-2 py-1 text-amber-200 hover:bg-white/10">
          ✕
        </button>
      </div>
    </div>
  );
}
