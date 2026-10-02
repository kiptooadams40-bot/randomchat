"use client";

import { useEffect, useRef, useState } from "react";
import type { BlurMode } from "@/hooks/useRandomChat";
import VideoTile from "./VideoTile";

const OVERLAY = {
  tease: "The stranger is still waiting! Unlock to reconnect.",
  location: "Someone in your selected region is waiting! Unlock to see them.",
} as const;

const DRAG_THRESHOLD_PX = 6; // below this a press is a TAP (swap), above it a DRAG

const MAIN = "absolute inset-0 z-0";
const PIP =
  "absolute bottom-24 right-4 z-50 h-44 w-28 cursor-grab touch-none select-none overflow-hidden rounded-xl border border-gray-700 shadow-2xl active:cursor-grabbing sm:h-52 sm:w-36";

type Drag = {
  id: number; sx: number; sy: number; ox: number; oy: number;
  minX: number; maxX: number; minY: number; maxY: number; moved: boolean;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * WhatsApp-style call surface. The "main" video fills the stage; the other is a draggable
 * picture-in-picture window. Tap the PiP to swap them; drag it anywhere, but it can never
 * leave the stage (which is the viewport during a call).
 * The caller supplies the positioning class (`relative` inline, or `fixed inset-0 z-40` full-screen). Both <video> elements stay mounted
 * and only change role, so swapping is instant and never re-attaches a stream.
 */
export default function VideoStage({
  remote,
  local,
  blur,
  idle,
  onUnlock,
  className = "",
  children,
}: {
  remote: MediaStream | null;
  local: MediaStream | null;
  blur: BlurMode;
  idle: boolean;
  onUnlock: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const [swapped, setSwapped] = useState(false); // false: stranger main, you in PiP
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const containerRef = useRef<HTMLDivElement>(null);
  const pipRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const focusPipAfterSwap = useRef(false);

  // After a KEYBOARD swap the focused element stops being the PiP; follow the PiP so the next
  // Enter/Space keeps working.
  useEffect(() => {
    if (focusPipAfterSwap.current) {
      focusPipAfterSwap.current = false;
      pipRef.current?.focus();
    }
  }, [swapped]);

  // Keep the PiP inside the stage when the viewport changes (rotation, mobile browser bars, resize).
  useEffect(() => {
    const keepInside = () => {
      const c = containerRef.current?.getBoundingClientRect();
      const r = pipRef.current?.getBoundingClientRect();
      if (!c || !r) return;
      let dx = 0;
      let dy = 0;
      if (r.right > c.right) dx = c.right - r.right;
      if (r.left + dx < c.left) dx = c.left - r.left;
      if (r.bottom > c.bottom) dy = c.bottom - r.bottom;
      if (r.top + dy < c.top) dy = c.top - r.top;
      if (dx || dy) setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    };
    keepInside();
    window.addEventListener("resize", keepInside);
    window.addEventListener("orientationchange", keepInside);
    window.visualViewport?.addEventListener("resize", keepInside);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(keepInside) : null;
    if (containerRef.current) ro?.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", keepInside);
      window.removeEventListener("orientationchange", keepInside);
      window.visualViewport?.removeEventListener("resize", keepInside);
      ro?.disconnect();
    };
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const c = containerRef.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    if (!c) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = offsetRef.current;
    drag.current = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: x, oy: y,
      // How far the offset may change before an edge of the PiP meets an edge of the stage.
      minX: x - (r.left - c.left), maxX: x + (c.right - r.right),
      minY: y - (r.top - c.top), maxY: y + (c.bottom - r.bottom),
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    setOffset({ x: clamp(d.ox + dx, d.minX, d.maxX), y: clamp(d.oy + dy, d.minY, d.maxY) });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) setSwapped((s) => !s); // a tap swaps the two videos
  }

  const pipProps = {
    ref: pipRef,
    role: "button" as const,
    tabIndex: 0,
    "aria-label": "Swap the two videos. Drag to move this window.",
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => {
      drag.current = null;
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focusPipAfterSwap.current = true;
        setSwapped((s) => !s);
      }
    },
    style: { transform: `translate(${offset.x}px, ${offset.y}px)` },
  };

  const remoteIsPip = swapped;
  const localIsPip = !swapped;

  return (
    <div ref={containerRef} className={`overflow-hidden bg-black ${className}`}>
      <div key="remote" className={remoteIsPip ? PIP : MAIN} {...(remoteIsPip ? pipProps : {})}>
        <VideoTile
          stream={remote}
          className="h-full w-full"
          compact={remoteIsPip}
          label="Stranger"
          placeholder={idle ? "Stranger's video appears here" : "Waiting for a stranger…"}
          blurred={!!blur}
          overlay={
            blur &&
            (remoteIsPip ? (
              <span aria-label="Locked" className="text-xl">🔒</span>
            ) : (
              <>
                <p className="animate-pulse px-6 text-lg font-extrabold drop-shadow sm:text-2xl">{OVERLAY[blur]}</p>
                <button
                  onClick={onUnlock}
                  className="animate-pulse rounded-full bg-amber-400 px-6 py-2.5 text-sm font-extrabold text-black hover:bg-amber-300"
                >
                  Unlock now
                </button>
              </>
            ))
          }
        />
      </div>

      <div key="local" className={localIsPip ? PIP : MAIN} {...(localIsPip ? pipProps : {})}>
        <VideoTile
          stream={local}
          muted
          mirrored
          className="h-full w-full"
          compact={localIsPip}
          label="You"
          placeholder={localIsPip ? "Your camera" : "Your camera preview starts when you press Start"}
        />
      </div>

      {children}
    </div>
  );
}
