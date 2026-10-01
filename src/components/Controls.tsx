"use client";

import { useState } from "react";
import type { Phase } from "@/hooks/useRandomChat";

type Reason = "nudity" | "harassment" | "underage" | "spam" | "other";
const REASONS: [Reason, string][] = [
  ["nudity", "Nudity / sexual content"],
  ["harassment", "Harassment or abuse"],
  ["underage", "Appears to be under 18"],
  ["spam", "Spam or advertising"],
  ["other", "Something else"],
];

const btn = "rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-40";

export default function Controls({
  phase,
  micOn,
  camOn,
  onStart,
  onStop,
  onNext,
  onMic,
  onCam,
  onReport,
}: {
  phase: Phase;
  micOn: boolean;
  camOn: boolean;
  onStart: () => void;
  onStop: () => void;
  onNext: () => void;
  onMic: () => void;
  onCam: () => void;
  onReport: (r: Reason) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const idle = phase === "idle";
  const inCall = phase === "connected";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {idle ? (
        <button onClick={onStart} className={`${btn} bg-violet-600 hover:bg-violet-500`}>Start</button>
      ) : (
        <>
          <button onClick={onNext} className={`${btn} bg-violet-600 hover:bg-violet-500`}>Next</button>
          <button onClick={onStop} className={`${btn} bg-neutral-700 hover:bg-neutral-600`}>Stop</button>
        </>
      )}
      <button onClick={onMic} className={`${btn} ${micOn ? "bg-neutral-800" : "bg-red-600"}`}>
        {micOn ? "Mic on" : "Mic off"}
      </button>
      <button onClick={onCam} className={`${btn} ${camOn ? "bg-neutral-800" : "bg-red-600"}`}>
        {camOn ? "Camera on" : "Camera off"}
      </button>
      <div className="relative ml-auto">
        <button
          disabled={!inCall}
          onClick={() => setReporting((v) => !v)}
          className={`${btn} bg-red-950 text-red-200 hover:bg-red-900`}
        >
          Report
        </button>
        {reporting && inCall && (
          <div className="absolute bottom-full right-0 z-10 mb-2 w-64 rounded-xl border border-white/10 bg-neutral-900 p-2 shadow-xl">
            {REASONS.map(([r, label]) => (
              <button
                key={r}
                onClick={() => {
                  setReporting(false);
                  onReport(r);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
