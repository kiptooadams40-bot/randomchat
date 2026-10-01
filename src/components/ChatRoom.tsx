"use client";

import { useCallback, useEffect, useState } from "react";
import { useRandomChat, type Filter } from "@/hooks/useRandomChat";
import { COUNTRIES } from "@/lib/countries";
import { FREE_MATCHES, GENDER_FILTERS, TEASE_SECONDS } from "@/lib/plans";
import AgeGate from "./AgeGate";
import ChatPanel from "./ChatPanel";
import Controls from "./Controls";
import FlashDealModal from "./FlashDealModal";
import PaywallModal from "./PaywallModal";
import VideoTile from "./VideoTile";

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

const OVERLAY = {
  tease: "The stranger is still waiting! Unlock to reconnect.",
  location: "Someone in your selected region is waiting! Unlock to see them.",
} as const;

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
  const chat = useRandomChat({ filter, country });

  const refresh = useCallback(async () => {
    const r = await fetch("/api/session", { cache: "no-store" });
    const s: Session = await r.json();
    setSession(s);
    return s;
  }, []);

  useEffect(() => {
    void refresh();
  }, [chat.phase, refresh]);

  const onPaid = useCallback(async () => {
    await refresh();
    chat.unlock();
  }, [refresh, chat]);

  if (!session) return <p className="text-neutral-400">Loading…</p>;
  if (!session.ageVerified) {
    // Re-read the server's view: only proceeds if the verification actually persisted.
    return <AgeGate onVerified={async () => (await refresh()).ageVerified} />;
  }

  const idle = chat.phase === "idle";
  const connected = chat.phase === "connected";
  const hasAccess = session.premium || session.vip;
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-neutral-300">{STATUS[chat.phase]}</span>
        <div className="flex items-center gap-2">
          {chat.limitEndsAt && <Countdown endsAt={chat.limitEndsAt} />}
          {session.premium ? (
            <span className="rounded-full bg-violet-600 px-3 py-1 text-xs font-bold">Premium · unlimited</span>
          ) : session.vip ? (
            <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-black">VIP · {vipLeft} left</span>
          ) : session.freeMatchesLeft ? (
            <span className="text-neutral-500">
              {session.freeMatchesLeft} free {session.freeMatchesLeft === 1 ? "match" : "matches"} left
              {session.freeMatchesLeft > FREE_MATCHES ? "" : ` of ${FREE_MATCHES}`}
            </span>
          ) : (
            <span className="text-amber-400">Preview mode: {TEASE_SECONDS}s clear video per match</span>
          )}
        </div>
      </div>

      {chat.error && <p className="rounded-lg bg-red-950 p-3 text-sm text-red-200">{chat.error}</p>}

      {/* Preferences (locked while searching / in a chat) */}
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-neutral-400">
            I am:
            <select
              value={session.gender ?? "none"}
              disabled={!idle}
              onChange={(e) => saveProfile({ gender: e.target.value })}
              className={selectCls}
            >
              <option value="none">Prefer not to say</option>
              <option value="boy">Boy</option>
              <option value="girl">Girl</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-neutral-400">
            I&apos;m in:
            <select
              value={session.country ?? "none"}
              disabled={!idle}
              onChange={(e) => saveProfile({ country: e.target.value })}
              className={selectCls}
            >
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
                disabled={!idle}
                aria-pressed={filter === f}
                className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                  filter === f ? "bg-violet-600" : "bg-neutral-800 hover:bg-neutral-700"
                }`}
              >
                {label} {f !== "both" && !session.premium && <span aria-label="Premium only">🔒</span>}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-neutral-400">
            Find people in:
            <select value={country} disabled={!idle} onChange={(e) => setCountry(e.target.value)} className={selectCls}>
              <option value="any">Anywhere</option>
              {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
        </div>
        {country !== "any" && !hasAccess && (
          <p className="text-xs text-amber-400">
            Location matches are blurred until you unlock a VIP pass or Premium.
          </p>
        )}
      </div>

      {/* Equal-size feeds: side by side from sm up, stacked on phones */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <VideoTile
          stream={chat.remoteStream}
          className="aspect-video w-full"
          placeholder={idle ? "Stranger's video appears here" : "Waiting for a stranger…"}
          label="Stranger"
          blurred={!!chat.blur}
          overlay={
            chat.blur && (
              <>
                <p className="animate-pulse text-lg font-extrabold drop-shadow sm:text-xl">{OVERLAY[chat.blur]}</p>
                <button
                  onClick={() => chat.setPaywall("vip")}
                  className="animate-pulse rounded-full bg-amber-400 px-5 py-2 text-sm font-extrabold text-black hover:bg-amber-300"
                >
                  Unlock now
                </button>
              </>
            )
          }
        />
        <VideoTile
          stream={chat.localStream}
          muted
          mirrored
          label="You"
          placeholder="Your camera preview starts when you press Start"
          className="aspect-video w-full"
        />
      </div>

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

      <div className="h-80">
        <ChatPanel messages={chat.messages} enabled={connected} onSend={chat.sendMessage} />
      </div>

      {dealOpen && chat.blur && (
        <FlashDealModal reason={chat.blur} onPaid={onPaid} onClose={() => chat.setPaywall(null)} />
      )}
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
