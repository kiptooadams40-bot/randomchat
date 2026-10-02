"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProfileRealtime } from "@/hooks/useProfileRealtime";
import { useRandomChat, type Filter } from "@/hooks/useRandomChat";
import { COUNTRIES } from "@/lib/countries";
import { FREE_MATCHES, GENDER_FILTERS, TEASE_SECONDS } from "@/lib/plans";
import AgeGate from "./AgeGate";
import ChatPanel from "./ChatPanel";
import Controls from "./Controls";
import FlashDealModal from "./FlashDealModal";
import PaywallModal from "./PaywallModal";
import VideoStage from "./VideoStage";

type Session = {
  ageVerified: boolean;
  premium: boolean;
  vip: boolean;
  vipUntil: number | null;
  gender: "boy" | "girl" | null;
  country: string | null;
  freeMatchesLeft: number | null;
};

const STATUS: Record<string, string> = {
  idle: "Press Start to meet someone new.",
  searching: "Looking for someone…",
  connecting: "Connecting…",
  connected: "You're connected. Be kind!",
};

const selectCls = "rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 disabled:opacity-50";

function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);
  const s = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-black">Free preview: {s}s left</span>;
}

export default function ChatRoom() {
  const [session, setSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState<Filter>("both");
  const [country, setCountry] = useState("any");
  const [premiumPrompt, setPremiumPrompt] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const chat = useRandomChat({ filter, country });
  const { unlock, setPaywall } = chat;

  /** Never throws: a failed/empty/non-JSON response becomes `loadError`, not a crash. */
  const refresh = useCallback(async (): Promise<Session | null> => {
    try {
      const r = await fetch("/api/session", { cache: "no-store" });
      const s = await r.json().catch(() => null);
      if (!r.ok || !s) {
        setLoadError(s?.hint ?? s?.error ?? `Service unavailable (${r.status}). Please try again.`);
        return null;
      }
      setLoadError(null);
      setSession(s as Session);
      return s as Session;
    } catch {
      setLoadError("Network error. Check your connection and try again.");
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [chat.phase, refresh]);

  // ── Instant entitlement sync (no page reload) ─────────────────────────────
  // 1) Realtime: the server fulfils a payment by updating this visitor's profile row; we hear it.
  useProfileRealtime(!!session, () => void refresh());
  // 2) Returning to the tab (e.g. after paying elsewhere) re-reads the server's view.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  // 3) Fallback while a paywall is up: poll, so it works even if Realtime isn't enabled.
  const paywalled = !!chat.blur || chat.paywall !== null || premiumPrompt;
  useEffect(() => {
    if (!paywalled) return;
    const i = setInterval(() => void refresh(), 5000);
    return () => clearInterval(i);
  }, [paywalled, refresh]);

  // When access arrives: drop the blur, close any paywall.
  const access = !!session && (session.premium || session.vip);
  useEffect(() => {
    if (access && chat.blur) unlock();
  }, [access, chat.blur, unlock]);
  useEffect(() => {
    if (session?.premium) {
      setPremiumPrompt(false);
      if (chat.paywall === "gender") setPaywall(null);
    }
  }, [session?.premium, chat.paywall, setPaywall]);

  // Immersive call: lock page scroll while the stage is full-screen.
  const inCall = chat.phase !== "idle";
  useEffect(() => {
    if (!inCall) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [inCall]);

  // Unread badge for the chat sheet.
  const msgCount = chat.messages.length;
  const lastCount = useRef(0);
  useEffect(() => {
    if (chatOpen || msgCount < lastCount.current) setSeen(msgCount);
    lastCount.current = msgCount;
  }, [chatOpen, msgCount]);
  const unread = Math.max(0, msgCount - seen);

  if (!session) {
    if (loadError) {
      return (
        <div className="max-w-md space-y-3 rounded-2xl border border-red-500/30 bg-red-950/30 p-5" role="alert">
          <p className="font-semibold">We couldn&apos;t load your session.</p>
          <p className="text-sm text-neutral-300">{loadError}</p>
          <button onClick={() => void refresh()} className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium hover:bg-violet-500">
            Try again
          </button>
        </div>
      );
    }
    return <p className="text-neutral-400">Loading…</p>;
  }
  if (!session.ageVerified) {
    // Re-read the server's view: only proceeds if the verification actually persisted.
    return <AgeGate onVerified={async () => (await refresh())?.ageVerified ?? false} />;
  }

  const idle = !inCall;
  const connected = chat.phase === "connected";
  const dealOpen = chat.paywall === "vip" && !!chat.blur;
  const premiumOpen = chat.paywall === "gender" || premiumPrompt;

  function pickFilter(f: Filter) {
    if (f !== "both" && !session?.premium) return setPremiumPrompt(true);
    setFilter(f);
  }

  async function saveProfile(body: { gender?: string; country?: string }) {
    await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    void refresh();
  }

  const vipMins = session.vipUntil ? Math.max(1, Math.ceil((session.vipUntil - Date.now()) / 60_000)) : 0;
  const vipLeft = vipMins >= 120 ? `${Math.ceil(vipMins / 60)}h` : `${vipMins}m`;

  const badges = (
    <div className="flex flex-wrap items-center gap-2">
      {chat.limitEndsAt && <Countdown endsAt={chat.limitEndsAt} />}
      {session.premium ? (
        <span className="rounded-full bg-violet-600 px-3 py-1 text-xs font-bold">Premium · unlimited</span>
      ) : session.vip ? (
        <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-black">VIP · {vipLeft} left</span>
      ) : session.freeMatchesLeft ? (
        <span className="text-xs text-neutral-300">
          {session.freeMatchesLeft} free {session.freeMatchesLeft === 1 ? "match" : "matches"} left
          {session.freeMatchesLeft > FREE_MATCHES ? "" : ` of ${FREE_MATCHES}`}
        </span>
      ) : (
        <span className="text-xs text-amber-400">Preview mode: {TEASE_SECONDS}s clear video per match</span>
      )}
    </div>
  );

  const controls = (
    <Controls
      phase={chat.phase}
      micOn={chat.micOn}
      camOn={chat.camOn}
      onStart={chat.start}
      onStop={chat.stop}
      onNext={chat.next}
      onMic={chat.toggleMic}
      onCam={chat.toggleCam}
      onReport={chat.report}
    />
  );

  return (
    <div className="space-y-4">
      {idle && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-neutral-300">{STATUS[chat.phase]}</span>
            {badges}
          </div>

          {chat.error && <p className="rounded-lg bg-red-950 p-3 text-sm text-red-200">{chat.error}</p>}

          {/* Preferences (only while not in a chat) */}
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-neutral-400">
                I am:
                <select value={session.gender ?? "none"} onChange={(e) => saveProfile({ gender: e.target.value })} className={selectCls}>
                  <option value="none">Prefer not to say</option>
                  <option value="boy">Boy</option>
                  <option value="girl">Girl</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-neutral-400">
                I&apos;m in:
                <select value={session.country ?? "none"} onChange={(e) => saveProfile({ country: e.target.value })} className={selectCls}>
                  <option value="none">Not set</option>
                  {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show me">
                <span className="text-neutral-400">Show me:</span>
                {GENDER_FILTERS.map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => pickFilter(f)}
                    aria-pressed={filter === f}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f ? "bg-violet-600" : "bg-neutral-800 hover:bg-neutral-700"}`}
                  >
                    {label} {f !== "both" && !session.premium && <span aria-label="Premium only">🔒</span>}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-neutral-400">
                Find people in:
                <select value={country} onChange={(e) => setCountry(e.target.value)} className={selectCls}>
                  <option value="any">Anywhere</option>
                  {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </label>
            </div>
            {country !== "any" && !access && (
              <p className="text-xs text-amber-400">Location matches are blurred until you unlock a VIP pass or Premium.</p>
            )}
          </div>
        </>
      )}

      {/* The call surface. Inline preview when idle; full-screen once a chat starts (same element,
          so the videos are never remounted). */}
      <VideoStage
        remote={chat.remoteStream}
        local={chat.localStream}
        blur={chat.blur}
        idle={idle}
        onUnlock={() => chat.setPaywall("vip")}
        className={
          idle
            ? "relative mx-auto aspect-[3/4] max-h-[60dvh] w-full max-w-md rounded-2xl sm:aspect-video sm:max-w-none"
            : "fixed inset-0 z-40"
        }
      >
        {!idle && (
          <>
            <div className="absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-sm">
              <span className="rounded-full bg-black/50 px-3 py-1 text-neutral-100">{STATUS[chat.phase]}</span>
              {badges}
            </div>

            {chat.error && (
              <p className="absolute inset-x-3 top-16 z-40 rounded-lg bg-red-950/90 p-3 text-sm text-red-200">{chat.error}</p>
            )}

            {chatOpen && (
              <div className="absolute inset-x-3 bottom-24 z-30 h-[45dvh] sm:right-auto sm:w-96">
                <ChatPanel messages={chat.messages} enabled={connected} onSend={chat.sendMessage} />
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {controls}
              <button
                onClick={() => setChatOpen((o) => !o)}
                aria-expanded={chatOpen}
                aria-label={unread ? `Chat, ${unread} unread` : "Chat"}
                className="relative rounded-full bg-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-700"
              >
                💬 Chat
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold">
                    {unread}
                  </span>
                )}
              </button>
            </div>
          </>
        )}
      </VideoStage>

      {idle && controls}

      {dealOpen && chat.blur && <FlashDealModal reason={chat.blur} onClose={() => chat.setPaywall(null)} />}
      {premiumOpen && (
        <PaywallModal
          onClose={() => {
            chat.setPaywall(null);
            setPremiumPrompt(false);
          }}
        />
      )}
    </div>
  );
}
