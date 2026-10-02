"use client";

import { useEffect, useRef } from "react";

/** One <video>. Shape/size come from `className` (the parent decides rounding). */
export default function VideoTile({
  stream,
  muted = false,
  mirrored = false,
  label,
  placeholder,
  blurred = false,
  overlay,
  compact = false,
  className = "",
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  label?: string;
  placeholder?: string;
  /** Heavy CSS blur; the underlying stream/connection is untouched. */
  blurred?: boolean;
  overlay?: React.ReactNode;
  /** Small (picture-in-picture) presentation: tiny text, no label. */
  compact?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);

  return (
    <div className={`relative overflow-hidden bg-neutral-900 ${className}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted || blurred}
        aria-label={label ? `${label} video` : undefined}
        className={`h-full w-full object-cover transition-[filter] duration-500 ${mirrored ? "-scale-x-100" : ""} ${
          blurred ? "scale-110 blur-3xl" : ""
        }`}
      />
      {!stream && placeholder && (
        <div className={`absolute inset-0 flex items-center justify-center text-center text-neutral-400 ${compact ? "p-2 text-[10px]" : "p-4 text-sm"}`}>
          {placeholder}
        </div>
      )}
      {blurred && overlay && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center bg-black/30 text-center ${compact ? "gap-1 p-1" : "gap-3 p-4"}`}>
          {overlay}
        </div>
      )}
      {label && !compact && (
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">{label}</span>
      )}
    </div>
  );
}
