"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { STEPS, timeline, type Run, type Step } from "@/lib/conn-timeline";

const LABEL: Record<Step, string> = {
  start: "Tapped Start/Next",
  joined: "Joined queue",
  matched: "Matched",
  offer: "Offer sent/recv",
  answer: "Answer recv/sent",
  iceConnected: "ICE connected",
  firstFrame: "First video frame",
};

const empty = { current: null, history: [] as Run[], env: { turn: null, audio: null } };

function summary(r: Run) {
  const m = r.steps.matched;
  const f = r.steps.firstFrame;
  return m !== undefined && f !== undefined ? `${f - m} ms` : "…";
}

/** Small timing panel, only rendered when the page URL has ?debug=1. */
export default function DebugOverlay() {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setOn(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);
  const s = useSyncExternalStore(timeline.subscribe, timeline.get, () => empty);
  if (!on) return null;

  const r = s.current;
  const copy = () => void navigator.clipboard?.writeText(JSON.stringify([r, ...s.history], null, 2)).catch(() => {});

  return (
    <div className="fixed left-2 top-2 z-[60] max-w-[16rem] rounded-lg bg-black/80 p-2 font-mono text-[10px] leading-tight text-green-300 shadow-lg">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left font-bold text-white">
        debug {open ? "▾" : "▸"} matched→video: {r ? summary(r) : "-"}
      </button>
      {open && r && (
        <div className="mt-1 space-y-0.5">
          <div>role: {r.role ?? "-"}</div>
          {STEPS.map((k) => (
            <div key={k} className="flex justify-between gap-3">
              <span>{LABEL[k]}</span>
              <span>{r.steps[k] !== undefined ? `+${r.steps[k]}ms` : "-"}</span>
            </div>
          ))}
          <div>
            path: {r.local ?? "?"} ↔ {r.remote ?? "?"} {r.protocol ? `(${r.protocol})` : ""}
            {r.rttMs !== null ? ` rtt ${r.rttMs}ms` : ""}
          </div>
          <div>turn: {s.env.turn === null ? "?" : s.env.turn ? "yes" : "no (STUN only)"}</div>
          <div>mic: {s.env.audio ?? "?"}</div>
          {r.note && <div className="text-amber-300">{r.note}</div>}
          {s.history.length > 0 && (
            <div className="border-t border-white/20 pt-1 text-neutral-300">
              previous: {s.history.map(summary).join(", ")}
            </div>
          )}
          <button onClick={copy} className="mt-1 rounded bg-white/10 px-2 py-0.5 text-white">copy JSON</button>
        </div>
      )}
    </div>
  );
}
