"use client";

import { useEffect, useRef } from "react";

export default function VideoTile({
  stream,
  muted = false,
  mirrored = false,
  label,
  placeholder,
  blurred = false,
  overlay,
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
    <div className={`relative overflow-hidden rounded-2xl bg-neutral-900 ${className}`}>
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
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-400">
          {placeholder}
        </div>
      )}
      {blurred && overlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30 p-4 text-center">
          {overlay}
        </div>
      )}
      {label && (
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">{label}</span>
      )}
    </div>
  );
}
