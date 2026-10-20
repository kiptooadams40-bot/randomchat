"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { recordCandidatePair, timeline } from "@/lib/conn-timeline";
import { supabaseBrowser } from "@/lib/supabase-browser";

export type Phase = "idle" | "searching" | "connecting" | "connected";
export type ChatMsg = { id: number; from: "me" | "peer"; text: string; original?: string };
import { TEASE_SECONDS, type GenderFilter } from "@/lib/plans";

export type Filter = GenderFilter;
/** "vip" = flash-deal pass (blur unlock); "gender" = Premium upsell. */
export type PaywallReason = "vip" | "gender" | null;
export type BlurMode = "tease" | "location" | null;

type Role = "offerer" | "answerer";
type Signal = { id?: number; type: "offer" | "answer" | "ice"; payload: any };
type MatchRow = { id: string; user_a: string; user_b: string; blur_a: BlurMode; blur_b: BlurMode };
type SignalRow = { id: number; match_id: string; type: Signal["type"]; payload: any };

// Matches and signals are pushed over Supabase Realtime. HTTP polling only runs as a
// heartbeat (keeps the queue row / match alive server-side and catches any missed event),
// and falls back to the fast cadence whenever the Realtime channel is not connected.
const POLL_MS = 1000; // queue poll without Realtime
const HEARTBEAT_MS = 4000; // queue poll with Realtime (stale after 15s server-side)
const SIGNAL_MS = 700; // signal drain without Realtime
const SIGNAL_HEARTBEAT_MS = 3000; // signal drain with Realtime (stale after 30s server-side)
const PEER_TIMEOUT_MS = 8000; // no offer/answer by then: the partner is gone, find another
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

// ICE servers are static config: fetch once per page (prefetched on Start) so a new match
// never waits on this round trip.
let icePromise: Promise<RTCIceServer[] | undefined> | null = null;
const getIceServers = () =>
  (icePromise ??= api<{ iceServers?: RTCIceServer[] }>("/api/ice")
    .then(({ status, data }) => {
      if (status !== 200) icePromise = null;
      return data.iceServers;
    })
    .catch(() => {
      icePromise = null;
      return undefined;
    }));

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

  // Realtime: one channel per visitor, opened before the first search and kept open.
  const rtChannel = useRef<RealtimeChannel | null>(null);
  const rtLive = useRef(false); // channel is SUBSCRIBED: polling drops to heartbeat cadence
  const onMatch = useRef<((row: MatchRow, uid: string) => void) | null>(null);
  const sigRoute = useRef<{ mid: string; push: (m: Signal) => void } | null>(null);
  const early = useRef<{ mid: string; list: Signal[] } | null>(null); // signals that beat beginPeer

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const closePeer = useCallback(() => {
    gen.current++;
    clearTimers();
    sigRoute.current = null;
    dc.current?.close();
    dc.current = null;
    pc.current?.close();
    pc.current = null;
    setRemoteStream(null);
    setMatchId(null);
    setLimitEndsAt(null);
    setBlur(null);
  }, []);

  const ensureRealtime = useCallback(async () => {
    const sb = supabaseBrowser();
    if (!sb || rtChannel.current) return;
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session || rtChannel.current) return;
    const uid = session.user.id;
    sb.realtime.setAuth(session.access_token); // so RLS applies to this visitor
    rtChannel.current = sb
      .channel(`chat:${uid}`)
      // The waiting side is always user_b (see rc_try_pair): told the instant it is paired.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches", filter: `user_b=eq.${uid}` },
        (p) => onMatch.current?.(p.new as MatchRow, uid),
      )
      // WebRTC offer / answer / ICE addressed to me (RLS: only in a live match I'm in).
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals", filter: `to_user=eq.${uid}` },
        (p) => {
          const row = p.new as SignalRow;
          const sig: Signal = { id: row.id, type: row.type, payload: row.payload };
          const route = sigRoute.current;
          if (route?.mid === row.match_id) return route.push(sig);
          // Peer not set up yet for this match: hold it until beginPeer picks it up.
          if (early.current?.mid === row.match_id) early.current.list.push(sig);
          else early.current = { mid: row.match_id, list: [sig] };
        },
      )
      .subscribe((status) => {
        rtLive.current = status === "SUBSCRIBED";
      });
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

      const iceServers = await getIceServers();
      if (!alive()) return;
      const conn = new RTCPeerConnection({ iceServers });
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

      // Partner gone: go straight back to the queue (joining ends this match server-side).
      const skip = () => {
        if (!alive()) return;
        closePeer();
        if (active.current) void startRef.current();
        else {
          void api("/api/match/leave", {});
          setPhase("idle");
        }
      };

      conn.oniceconnectionstatechange = () => {
        const s = conn.iceConnectionState;
        if (alive() && (s === "connected" || s === "completed")) {
          timeline.mark("iceConnected");
          void recordCandidatePair(conn);
        }
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

      // A partner who closed their tab never answers: don't make the user stare at it.
      timers.current.push(
        setTimeout(() => {
          if (alive() && !conn.remoteDescription) {
            timeline.patch({ note: "no offer/answer within 8s: skipped" });
            skip();
          }
        }, PEER_TIMEOUT_MS),
      );
      // Give up if ICE never completes (e.g. symmetric NAT without TURN).
      const connectTimer = setTimeout(() => {
        if (alive() && conn.connectionState !== "connected") {
          timeline.patch({ note: "not connected within 20s: skipped" });
          skip();
        }
      }, CONNECT_TIMEOUT_MS);
      timers.current.push(connectTimer);

      // The peer closing the call closes the data channel immediately.
      const onChannel = (ch: RTCDataChannel) => {
        wireChannel(ch);
        ch.onclose = skip;
      };
      if (role === "offerer") {
        onChannel(conn.createDataChannel("chat"));
      } else {
        conn.ondatachannel = (e) => onChannel(e.channel);
      }

      const pendingIce: RTCIceCandidateInit[] = [];
      const handle = async (m: Signal) => {
        if (m.type === "ice") {
          if (conn.remoteDescription) await conn.addIceCandidate(m.payload).catch(() => {});
          else pendingIce.push(m.payload);
          return;
        }
        if (m.type === "offer" && role === "answerer") {
          timeline.mark("offer");
          await conn.setRemoteDescription(m.payload);
        } else if (m.type === "answer" && role === "offerer") {
          timeline.mark("answer");
          await conn.setRemoteDescription(m.payload);
        } else return;
        for (const c of pendingIce.splice(0)) await conn.addIceCandidate(c).catch(() => {});
        if (m.type === "offer") {
          const answer = await conn.createAnswer();
          await conn.setLocalDescription(answer);
          await send("answer", conn.localDescription);
          timeline.mark("answer");
        }
      };

      // Signals arrive from Realtime and from the drain heartbeat: de-duplicate by row id
      // and apply strictly in order.
      const seen = new Set<number>();
      let chain = Promise.resolve();
      const push = (m: Signal) => {
        if (m.id !== undefined) {
          if (seen.has(m.id)) return;
          seen.add(m.id);
        }
        chain = chain.then(() => (alive() ? handle(m) : undefined)).catch(() => {});
      };
      sigRoute.current = { mid, push };
      if (early.current?.mid === mid) early.current.list.splice(0).forEach(push);
      early.current = null;

      const drain = async () => {
        if (!alive()) return;
        try {
          const { data } = await api<{ ended?: boolean; messages?: Signal[] }>(
            `/api/signal?matchId=${mid}`,
          );
          if (!alive()) return;
          if (data.ended) return skip();
          (data.messages ?? []).forEach(push);
        } catch {
          /* transient network error: keep polling */
        }
        if (alive()) timers.current.push(setTimeout(drain, rtLive.current ? SIGNAL_HEARTBEAT_MS : SIGNAL_MS));
      };
      void drain();

      if (role === "offerer") {
        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);
        if (alive()) {
          await send("offer", conn.localDescription);
          timeline.mark("offer");
        }
      }
    },
    [closePeer, wireChannel],
  );

  const start = useCallback(async () => {
    timeline.begin();
    setError(null);
    setPaywall(null);
    active.current = true;
    closePeer();
    void ensureRealtime().catch(() => {
      /* Realtime unavailable: polling covers it */
    });
    void getIceServers();
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

    const check = (s: any) => {
      if (gen.current !== myGen) return true;
      if (s.status === "matched") {
        timeline.mark("matched");
        timeline.patch({ role: s.role });
        onMatch.current = null;
        void beginPeer(s.matchId, s.role, s.blur ?? null, s.teaseMs ?? TEASE_SECONDS * 1000);
        return true;
      }
      return false;
    };
    // Armed before joining: the partner can pair with us before our join response returns.
    onMatch.current = (row, uid) => {
      const mine = row.user_a === uid;
      check({
        status: "matched",
        matchId: row.id,
        role: mine ? "offerer" : "answerer",
        blur: mine ? row.blur_a : row.blur_b,
      });
    };

    const joined = await api("/api/match/join", filterRef.current);
    if (gen.current !== myGen) return;
    if (joined.data?.error === "premium_required") {
      active.current = false;
      onMatch.current = null;
      setPaywall("gender");
      setPhase("idle");
      return;
    }
    if (joined.status !== 200) {
      active.current = false;
      onMatch.current = null;
      setError(joined.data?.error === "age_verification_required" ? "Please verify your age first." : "Could not join the queue.");
      setPhase("idle");
      return;
    }
    timeline.mark("joined");
    if (check(joined.data)) return;

    const poll = async () => {
      if (gen.current !== myGen) return;
      try {
        const { data } = await api("/api/match/poll");
        if (check(data)) return;
      } catch {
        /* keep polling */
      }
      timers.current.push(setTimeout(poll, rtLive.current ? HEARTBEAT_MS : POLL_MS));
    };
    timers.current.push(setTimeout(poll, rtLive.current ? HEARTBEAT_MS : POLL_MS));
  }, [beginPeer, closePeer, ensureMedia, ensureRealtime]);
  startRef.current = start;

  const stop = useCallback(() => {
    active.current = false;
    onMatch.current = null;
    closePeer();
    void api("/api/match/leave", {});
    setPhase("idle");
    setMessages([]);
  }, [closePeer]);

  // Joining ends the current chat server-side, so Next is a single round trip.
  const next = useCallback(() => {
    void startRef.current();
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

  // Open the Realtime channel up front so it is already live when the user hits Start.
  useEffect(() => {
    void ensureRealtime().catch(() => {});
  }, [ensureRealtime]);

  // Release everything on unmount / tab close.
  useEffect(() => {
    const bye = () => navigator.sendBeacon?.("/api/match/leave");
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      active.current = false;
      onMatch.current = null;
      closePeer();
      local.current?.getTracks().forEach((t) => t.stop());
      local.current = null;
      void api("/api/match/leave", {});
      const ch = rtChannel.current;
      rtChannel.current = null;
      rtLive.current = false;
      if (ch) void supabaseBrowser()?.removeChannel(ch);
    };
  }, [closePeer]);

  return {
    phase, error, paywall, setPaywall, limitEndsAt, blur, unlock, messages, localStream, remoteStream,
    micOn, camOn, matchId,
    start, stop, next, sendMessage, report, toggleMic, toggleCam,
  };
}
