"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMsg } from "@/hooks/useRandomChat";

type Lang = "en" | "fr" | "es";
const LANGS: [Lang, string][] = [
  ["en", "English"],
  ["fr", "Français"],
  ["es", "Español"],
];

async function translate(text: string, to: Lang, from: Lang | "auto"): Promise<string> {
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, to, from }),
    });
    const data = await res.json();
    return typeof data.text === "string" ? data.text : text;
  } catch {
    return text;
  }
}

const select = "rounded bg-neutral-800 px-2 py-1 text-xs outline-none";

export default function ChatPanel({
  messages,
  enabled,
  onSend,
}: {
  messages: ChatMsg[];
  enabled: boolean;
  onSend: (text: string, original?: string) => boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [translateOn, setTranslateOn] = useState(false);
  const [myLang, setMyLang] = useState<Lang>("en"); // language I read (incoming is translated to this)
  const [sendLang, setSendLang] = useState<Lang | "same">("same"); // language my messages are sent in
  const [cache, setCache] = useState<Record<string, string>>({}); // `${id}:${lang}` -> translation
  const endRef = useRef<HTMLDivElement>(null);
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, cache]);

  // Translate incoming peer messages into my language (lazily, once each).
  useEffect(() => {
    if (!translateOn) return;
    for (const m of messages) {
      const key = `${m.id}:${myLang}`;
      if (m.from !== "peer" || cache[key] !== undefined || inflight.current.has(key)) continue;
      inflight.current.add(key);
      translate(m.text, myLang, "auto").then((t) => {
        inflight.current.delete(key);
        setCache((c) => ({ ...c, [key]: t }));
      });
    }
  }, [messages, translateOn, myLang, cache]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const original = text.trim();
    if (!original || sending) return;
    let out = original;
    if (translateOn && sendLang !== "same" && sendLang !== myLang) {
      setSending(true);
      out = await translate(original, sendLang, myLang);
      setSending(false);
    }
    if (onSend(out, out !== original ? original : undefined)) setText("");
  }

  return (
    <div className="flex h-full min-h-64 flex-col rounded-2xl border border-white/10 bg-neutral-900/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={translateOn} onChange={(e) => setTranslateOn(e.target.checked)} />
          Translate
        </label>
        {translateOn && (
          <>
            <label className="flex items-center gap-1 text-neutral-400">
              I read
              <select className={select} value={myLang} onChange={(e) => setMyLang(e.target.value as Lang)}>
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-neutral-400">
              Send in
              <select className={select} value={sendLang} onChange={(e) => setSendLang(e.target.value as Lang | "same")}>
                <option value="same">As typed</option>
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-neutral-500">{enabled ? "Say hi 👋" : "Messages appear here once connected."}</p>
        )}
        {messages.map((m) => {
          const t = translateOn && m.from === "peer" ? cache[`${m.id}:${myLang}`] : undefined;
          const shown = t ?? m.text;
          const note = t !== undefined && t !== m.text ? m.text : m.original;
          return (
            <div key={m.id} className={m.from === "me" ? "text-right" : ""}>
              <span
                className={`inline-block max-w-[85%] break-words rounded-2xl px-3 py-1.5 text-left ${
                  m.from === "me" ? "bg-violet-600" : "bg-neutral-800"
                }`}
              >
                {shown}
                {note && <span className="block text-[11px] italic opacity-60">{m.from === "me" ? "You typed" : "Original"}: {note}</span>}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form className="flex gap-2 border-t border-white/10 p-2" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!enabled}
          maxLength={500}
          aria-label="Chat message"
          placeholder={enabled ? "Type a message" : "Not connected"}
          className="min-w-0 flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none disabled:opacity-50"
        />
        <button
          disabled={!enabled || !text.trim() || sending}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium disabled:opacity-40"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
