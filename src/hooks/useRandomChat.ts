"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Phase = "idle" | "searching" | "connecting" | "connected";
export type ChatMsg = { id: number; from: "me" | "peer"; text: string; original?: string };
import type { GenderFilter } from "@/lib/plans";

export type Filter = GenderFilter;
/** "vip" = flash-deal pass (blur unlock); "gender" = Premium upsell. */
export type PaywallReason = "vip" | "gender" | null;
export type BlurMode = "tease" | "location" | null;

type Role = "offerer" | "answerer";
type Signal = { type: "offer" | "answer" | "ice"; payload: any };

const POLL_MS = 1000;
const SIGNAL_MS = 700;
const CONNECT_TIMEOUT_MS = 20_000;
const MAX_MSG = 500;

async function api<T = any>(url: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export function useRandomChat({ filter, country }: { filter: Filter; country: string }) {
  const filterRef = useRef({ filter, country });
  filterRef.current = { filter, country };
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason>(null);
  const [limitEndsAt, setLimitEndsAt] = useState<number | null>(null);
  const [blur, setBlur] = useState<BlurMode>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [matchId, setMatchId] = useState<string | null>(null);

  const gen = useRef(0); // bumps on every teardown; stale async loops bail out
  const active = useRef(false); // user wants to keep chatting (auto-requeue)
  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const local = useRef<MediaStream | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const msgId = useRef(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const closePeer = useCallback(() => {
    gen.current++;
    clearTimers();
    dc.current?.close();
    dc.current = null;
    pc.current?.close();
    pc.current = null;
    setRemoteStream(null);
    setMatchId(null);
    setLimitEndsAt(null);
    setBlur(null);
  }, []);

  const ensureMedia = useCallback(async () => {
    if (local.current) return local.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    local.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const wireChannel = useCallback((ch: RTCDataChannel) => {
    dc.current = ch;
    ch.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const text = e.data.slice(0, MAX_MSG);
      setMessages((m) => [...m, { id: ++msgId.current, from: "peer", text }]);
    };
  }, []);

  // Forward-declared so the peer can trigger re-queueing when it drops.
  const startRef = useRef<() => Promise<void>>(async () => {});

  const beginPeer = useCallback(
    async (mid: string, role: Role, blurMode: BlurMode, teaseMs: number) => {
      const myGen = ++gen.current;
      const alive = () => gen.current === myGen;
      setMatchId(mid);
      setPhase("connecting");
      setMessages([]);

      const { data } = await api<{ iceServers: RTCIceServer[] }>("/api/ice");
      if (!alive()) return;
      const conn = new RTCPeerConnection({ iceServers: data.iceServers });
      pc.current = conn;
      const stream = local.current!;
      stream.getTracks().forEach((t) => conn.addTrack(t, stream));

      const remote = new MediaStream();
      conn.ontrack = (e) => {
        e.streams[0]?.getTracks().forEach((t) => {
          if (!remote.getTracks().includes(t)) remote.addTrack(t);
        });
        setRemoteStream(new MediaStream(remote.getTracks()));
      };

      const send = (type: Signal["type"], payload: unknown) =>
        api("/api/signal", { matchId: mid, type, payload });

      conn.onicecandidate = (e) => {
        if (e.candidate && alive()) void send("ice", e.candidate.toJSON());
      };

      const skip = () => {
        if (!alive()) return;
        closePeer();
        void api("/api/match/leave", {});
        if (active.current) void startRef.current();
        else setPhase("idle");
      };

      conn.onconnectionstatechange = () => {
        if (!alive()) return;
        const s = conn.connectionState;
        if (s === "connected") {
          clearTimeout(connectTimer);
          setPhase("connected");
          void api("/api/match/connected", { matchId: mid });
          if (blurMode === "location") {
            // Free user searched by region: real match, blurred from the first frame.
            setBlur("location");
            setPaywall("vip");
          } else if (blurMode === "tease") {
            // Match 8+: 10s clear, then blur (the connection stays up) and show the flash deal.
            setLimitEndsAt(Date.now() + teaseMs);
            timers.current.push(
              setTimeout(() => {
                if (!alive()) return;
                setLimitEndsAt(null);
                setBlur("tease");
                setPaywall("vip");
              }, teaseMs),
            );
          }
        } else if (s === "failed" || s === "closed") {
          skip();
        }
      };

      // Give up if ICE never completes (e.g. symmetric NAT without TURN).
      const connectTimer = setTimeout(() => {
        if (alive() && conn.connectionState !== "connected") skip();
      }, CONNECT_TIMEOUT_MS);
      timers.current.push(connectTimer);

      if (role === "offerer") {
        wireChannel(conn.createDataChannel("chat"));
      } else {
        conn.ondatachannel = (e) => wireChannel(e.channel);
      }

      const pendingIce: RTCIceCandidateInit[] = [];
      const handle = async (m: Signal) => {
        if (m.type === "ice") {
          if (conn.remoteDescription) await conn.addIceCandidate(m.payload).catch(() => {});
          else pendingIce.push(m.payload);
          return;
        }
        if (m.type === "offer" && role === "answerer") {
          await conn.setRemoteDescription(m.payload);
        } else if (m.type === "answer" && role === "offerer") {
          await conn.setRemoteDescription(m.payload);
        } else return;
        for (const c of pendingIce.splice(0)) await conn.addIceCandidate(c).catch(() => {});
        if (m.type === "offer") {
          const answer = await conn.createAnswer();
          await conn.setLocalDescription(answer);
          await send("answer", conn.localDescription);
        }
      };

      const pollSignals = async () => {
        if (!alive()) return;
        try {
          const { data } = await api<{ ended?: boolean; messages?: Signal[] }>(
            `/api/signal?matchId=${mid}`,
          );
          if (!alive()) return;
          if (data.ended) return skip();
          for (const m of data.messages ?? []) await handle(m);
        } catch {
          /* transient network error: keep polling */
        }
        if (alive()) timers.current.push(setTimeout(pollSignals, SIGNAL_MS));
      };
      void pollSignals();

      if (role === "offerer") {
        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);
        if (alive()) await send("offer", conn.localDescription);
      }
    },
    [closePeer, wireChannel],
  );

  const start = useCallback(async () => {
    setError(null);
    setPaywall(null);
    active.current = true;
    closePeer();
    try {
      await ensureMedia();
    } catch {
      active.current = false;
      setError("Camera/microphone access is required. Allow it in your browser and try again.");
      setPhase("idle");
      return;
    }
    const myGen = gen.current;
    setPhase("searching");
    const joined = await api("/api/match/join", filterRef.current);
    if (gen.current !== myGen) return;
    if (joined.data?.error === "premium_required") {
      active.current = false;
      setPaywall("gender");
      setPhase("idle");
      return;
    }
    if (joined.status !== 200) {
      active.current = false;
      setError(joined.data?.error === "age_verification_required" ? "Please verify your age first." : "Could not join the queue.");
      setPhase("idle");
      return;
    }

    const check = (s: any) => {
      if (s.status === "matched") {
        void beginPeer(s.matchId, s.role, s.blur ?? null, s.teaseMs ?? 10_000);
        return true;
      }
      return false;
    };
    if (check(joined.data)) return;

    const poll = async () => {
      if (gen.current !== myGen) return;
      try {
        const { data } = await api("/api/match/poll");
        if (gen.current !== myGen) return;
        if (check(data)) return;
      } catch {
        /* keep polling */
      }
      timers.current.push(setTimeout(poll, POLL_MS));
    };
    timers.current.push(setTimeout(poll, POLL_MS));
  }, [beginPeer, closePeer, ensureMedia]);
  startRef.current = start;

  const stop = useCallback(() => {
    active.current = false;
    closePeer();
    void api("/api/match/leave", {});
    setPhase("idle");
    setMessages([]);
  }, [closePeer]);

  const next = useCallback(() => {
    void api("/api/match/leave", {}).finally(() => void startRef.current());
  }, []);

  const sendMessage = useCallback((text: string, original?: string) => {
    const t = text.trim().slice(0, MAX_MSG);
    if (!t || dc.current?.readyState !== "open") return false;
    dc.current.send(t);
    setMessages((m) => [...m, { id: ++msgId.current, from: "me", text: t, original }]);
    return true;
  }, []);

  const report = useCallback(
    async (reason: "nudity" | "harassment" | "underage" | "spam" | "other") => {
      if (!matchId) return;
      await api("/api/report", { matchId, reason });
      closePeer();
      if (active.current) void startRef.current();
      else setPhase("idle");
    },
    [matchId, closePeer],
  );

  /** Called once a VIP pass / Premium is active: removes the blur on the live call. */
  const unlock = useCallback(() => {
    setBlur(null);
    setLimitEndsAt(null);
    setPaywall(null);
  }, []);

  const toggleMic = useCallback(() => {
    const on = !micOn;
    local.current?.getAudioTracks().forEach((t) => (t.enabled = on));
    setMicOn(on);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const on = !camOn;
    local.current?.getVideoTracks().forEach((t) => (t.enabled = on));
    setCamOn(on);
  }, [camOn]);

  // Release everything on unmount / tab close.
  useEffect(() => {
    const bye = () => navigator.sendBeacon?.("/api/match/leave");
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      active.current = false;
      closePeer();
      local.current?.getTracks().forEach((t) => t.stop());
      local.current = null;
      void api("/api/match/leave", {});
    };
  }, [closePeer]);

  return {
    phase, error, paywall, setPaywall, limitEndsAt, blur, unlock, messages, localStream, remoteStream,
    micOn, camOn, matchId,
    start, stop, next, sendMessage, report, toggleMic, toggleCam,
  };
}
