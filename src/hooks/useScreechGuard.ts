"use client";

import { useEffect, useRef } from "react";
import { SCREECH, ScreechDetector } from "@/lib/screech";

/**
 * Watches the LOCAL microphone for acoustic feedback (two devices in one room hearing each
 * other) and calls `onScreech`. Detection rules live in lib/screech.ts. The analyser is never
 * connected to the speakers: there is no Web Audio output path.
 */
export function useScreechGuard(stream: MediaStream | null, enabled: boolean, onScreech: () => void) {
  const cb = useRef(onScreech);
  cb.current = onScreech;

  useEffect(() => {
    const tracks = stream?.getAudioTracks() ?? [];
    if (!enabled || !tracks.length) return;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    void ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(new MediaStream(tracks));
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    src.connect(an); // deliberately NOT connected to ctx.destination

    const detector = new ScreechDetector(ctx.sampleRate, an.frequencyBinCount);
    const freq = new Float32Array(an.frequencyBinCount);
    const time = new Float32Array(an.fftSize);
    const id = setInterval(() => {
      an.getFloatTimeDomainData(time);
      an.getFloatFrequencyData(freq);
      if (detector.frame(time, freq, performance.now())) cb.current();
    }, SCREECH.TICK_MS);
    return () => {
      clearInterval(id);
      src.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [stream, enabled]);
}
