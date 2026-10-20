"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { recordCandidatePair, timeline } from "@/lib/conn-timeline";
import { TEASE_SECONDS, type GenderFilter } from "@/lib/plans";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useScreechGuard } from "./useScreechGuard";

export type Phase = "idle" | "searching" | "connecting" | "connected";
export type ChatMsg = { id: number; from: "me" | "peer"; text: string; original?: string };

export type Filter = GenderFilter;
/** "vip" = flash-deal pass (blur unlock); "gender" = Premium upsell. */
export type PaywallReason = "vip" | "gender" | null;
export type BlurMode = "tease" | "location" | null;

type Role = "offerer" | "answerer";
type MatchMsg = { status: "matched"; matchId: string; role: Role; blur: BlurMode; teaseMs?: number };
/** Messages on the private Broadcast channel "match:<id>". Never stored anywhere. */
type Sig =
  | { type: "hello" | "hello-ack" | "bye" }
  | { type: "offer" | "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

const QUEUE_HEARTBEAT_MS = 4000; // queue row goes stale after 15s; also backs up the Broadcast notice
const QUEUE_POLL_MS = 1000; // when the Realtime channel isn't live
const CALL_HEARTBEAT_MS = 5000; // keeps the match alive server-side (stale after 30s)
const RESTART_AFTER_MS = 8000; // not connected 8s after matching: one ICE restart
const GIVE_UP_AFTER_RESTART_MS = 5000; // still not connected: move on
const REALTIME_WAIT_MS = 1500; // how long Start waits for the match channel before joining anyway
const POOL_SIZE = 2;
const MAX_MSG = 500;
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const NO_CONNECT = "Couldn't connect, finding someone new…";

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── ICE servers: short-lived TURN credentials from our server, fetched once on Start ──
type Ice = { servers: RTCIceServer[]; until: number };
let iceCache: Ice | null = null;
let iceInflight: Promise<Ice> | null = null;
const STUN_ONLY: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

function getIce(): Promise<Ice> {
  if (iceCache && iceCache.until > Date.now()) return Promise.resolve(iceCache);
  return (iceInflight ??= api<{ iceServers?: RTCIceServer[]; ttl?: number; turn?: boolean }>("/api/ice")
    .then(({ status, data }) => {
      if (status !== 200 || !data.iceServers?.length) throw new Error("ice");
      timeline.setEnv({ turn: !!data.turn });
      // Refresh 10 minutes before the credentials expire.
      iceCache = { servers: data.iceServers, until: Date.now() + Math.max(60, (data.ttl ?? 600) - 600) * 1000 };
      return iceCache;
    })
    .catch(() => ({ servers: STUN_ONLY, until: 0 }))
    .finally(() => {
      iceInflight = null;
    }));
}

/** Turns on any of echo cancellation / noise suppression / auto gain the browser left off. */
async function checkAudioProcessing(track: MediaStreamTrack | undefined) {
  if (!track) return;
  const off = () => {
    const s = track.getSettings() as Record<string, unknown>;
    return (Object.keys(AUDIO) as (keyof typeof AUDIO)[]).filter((k) => s[k] === false);
  };
  if (off().length) await track.applyConstraints(AUDIO).catch(() => {});
  const s = track.getSettings() as Record<string, unknown>;
  const show = (k: string) => (s[k] === undefined ? "?" : s[k] ? "on" : "OFF");
  timeline.setEnv({ audio: `echoCancel ${show("echoCancellation")}, noiseSupp ${show("noiseSuppression")}, autoGain ${show("autoGainControl")}` });
  if (off().length) console.warn("[media] audio processing still off:", off());
}

export function useRandomChat({ filter, country }: { filter: Filter; country: string }) {
  const filterRef = useRef({ filter, country });
  filterRef.current = { filter, country };
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason>(null);
  const [limitEndsAt, setLimitEndsAt] = useState<number | null>(null);
  const [blur, setBlur] = useState<BlurMode>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localPreview, setLocalPreview] = useState<MediaStream | null>(null); // video only: can never play your own mic
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [echoWarning, setEchoWarning] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);

  const gen = useRef(0); // bumps on every teardown; stale async work bails out
  const active = useRef(false); // user wants to keep chatting (auto-requeue)
  const pc = useRef<RTCPeerConnection | null>(null);
  const spare = useRef<RTCPeerConnection | null>(null); // pre-built, already gathering ICE
  const dc = useRef<RTCDataChannel | null>(null);
  const matchChan = useRef<RealtimeChannel | null>(null);
  const local = useRef<MediaStream | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const msgId = useRef(0);
  const micWanted = useRef(true);
  const echoMuted = useRef(false);
  const echoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Realtime: opened on the first Start tap only (never for visitors who don't start).
  const rt = useRef<{ sb: SupabaseClient; channel: RealtimeChannel; live: boolean } | null>(null);
  const rtPromise = useRef<Promise<unknown> | null>(null);
  const onMatch = useRef<((m: MatchMsg) => void) | null>(null);

  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const applyMic = () =>
    local.current?.getAudioTracks().forEach((t) => (t.enabled = micWanted.current && !echoMuted.current));

  /** Ends the current peer (if any): tells the partner, drops its channel, stops its media. */
  const closePeer = useCallback(() => {
    gen.current++;
    clearTimers();
    const ch = matchChan.current;
    matchChan.current = null;
    if (ch) {
      void ch.send({ type: "broadcast", event: "sig", payload: { type: "bye" } }).catch(() => {});
      void supabaseBrowser()?.removeChannel(ch); // also drops its listeners
    }
    if (dc.current) {
      dc.current.onclose = null;
      dc.current.close();
      dc.current = null;
    }
    const conn = pc.current;
    pc.current = null;
    if (conn) {
      conn.ontrack = conn.onicecandidate = conn.onconnectionstatechange = conn.oniceconnectionstatechange = conn.ondatachannel = null;
      conn.getReceivers().forEach((r) => r.track?.stop());
      conn.close();
    }
    setRemoteStream(null);
    setMatchId(null);
    setLimitEndsAt(null);
    setBlur(null);
  }, []);

  const ensureRealtime = useCallback(() => {
    return (rtPromise.current ??= (async () => {
      const sb = supabaseBrowser();
      if (!sb) return;
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) {
        rtPromise.current = null; // session cookie not set yet: try again next Start
        return;
      }
      await sb.realtime.setAuth(session.access_token); // private channels check RLS as this visitor
      const state = { sb, channel: null as unknown as RealtimeChannel, live: false };
      await new Promise<void>((resolve) => {
        state.channel = sb
          .channel(`user:${session.user.id}`, { config: { private: true } })
          .on("broadcast", { event: "matched" }, ({ payload }) => onMatch.current?.(payload as MatchMsg))
          .subscribe((status) => {
            state.live = status === "SUBSCRIBED";
            if (status !== "CLOSED") resolve();
          });
      });
      rt.current = state;
    })().catch(() => {
      rtPromise.current = null;
    }));
  }, []);

  /** Camera + mic are requested ONCE and reused for every match. */
  const ensureMedia = useCallback(async () => {
    if (local.current) return local.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: AUDIO,
    });
    local.current = stream;
    void checkAudioProcessing(stream.getAudioTracks()[0]);
    setLocalStream(stream);
    setLocalPreview(new MediaStream(stream.getVideoTracks()));
    applyMic();
    return stream;
  }, []);

  const newPc = (servers: RTCIceServer[]) => new RTCPeerConnection({ iceServers: servers, iceCandidatePoolSize: POOL_SIZE });

  /** Builds the next peer connection while searching, so ICE gathering is done before a match. */
  const prepareSpare = useCallback(() => {
    if (spare.current) return;
    void getIce().then((ice) => {
      if (!spare.current && active.current) spare.current = newPc(ice.servers);
    });
  }, []);

  const takePc = (servers: RTCIceServer[]) => {
    const s = spare.current;
    spare.current = null;
    return s && s.signalingState !== "closed" ? s : newPc(servers);
  };

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

      const [{ servers }] = await Promise.all([getIce(), ensureRealtime()]);
      const sb = rt.current?.sb ?? supabaseBrowser();
      if (!alive() || !sb) return;

      const conn = takePc(servers);
      pc.current = conn;
      const stream = local.current!;
      stream.getTracks().forEach((t) => conn.addTrack(t, stream));

      // Exactly one remote stream per call, attached to exactly one <video> element.
      // Renegotiation (ICE restart) fires no new ontrack for existing tracks, and a second
      // track of the same stream doesn't re-attach it, so the audio is never played twice.
      let fallback: MediaStream | null = null;
      let shown: MediaStream | null = null;
      conn.ontrack = (e) => {
        const s = e.streams[0] ?? (fallback ??= new MediaStream());
        if (!e.streams[0] && !s.getTracks().includes(e.track)) s.addTrack(e.track);
        if (shown !== s) {
          shown = s;
          setRemoteStream(s);
        }
      };

      const ch = sb.channel(`match:${mid}`, { config: { private: true, broadcast: { self: false } } });
      matchChan.current = ch;
      const send = (s: Sig) => {
        if (alive()) void ch.send({ type: "broadcast", event: "sig", payload: s }).catch(() => {});
      };

      // Leave: Next if still searching for more, otherwise idle.
      const skip = (message?: string) => {
        if (!alive()) return;
        closePeer();
        if (message) {
          setNotice(message);
          setTimeout(() => setNotice((n) => (n === message ? null : n)), 3000);
        }
        if (active.current) void startRef.current();
        else {
          void api("/api/match/leave", {});
          setPhase("idle");
        }
      };

      // Trickle ICE: our candidates go out as soon as our description has been sent.
      let descSent = false;
      const outIce: RTCIceCandidateInit[] = [];
      const inIce: RTCIceCandidateInit[] = [];
      conn.onicecandidate = (e) => {
        if (!e.candidate || !alive()) return;
        const c = e.candidate.toJSON();
        if (descSent) send({ type: "ice", candidate: c });
        else outIce.push(c);
      };
      const flushOut = () => {
        descSent = true;
        outIce.splice(0).forEach((c) => send({ type: "ice", candidate: c }));
      };
      const flushIn = async () => {
        for (const c of inIce.splice(0)) await conn.addIceCandidate(c).catch(() => {});
      };

      let connected = false;
      let restarted = false;
      const fail = () => skip(NO_CONNECT);
      const restartIce = async () => {
        if (restarted || role !== "offerer" || !alive()) return;
        restarted = true;
        timeline.patch({ note: "ICE restart" });
        await conn.setLocalDescription(await conn.createOffer({ iceRestart: true }));
        send({ type: "offer", sdp: conn.localDescription!.toJSON() });
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
          if (connected) return;
          connected = true;
          setPhase("connected");
          void api("/api/match/connected", { matchId: mid });
          if (blurMode === "location") {
            // Free user searched by region: real match, blurred from the first frame.
            setBlur("location");
            setPaywall("vip");
          } else if (blurMode === "tease") {
            // Match 8+: 10s clear, then blur (the connection stays up) and show the flash deal.
            setLimitEndsAt(Date.now() + teaseMs);
            later(() => {
              if (!alive()) return;
              setLimitEndsAt(null);
              setBlur("tease");
              setPaywall("vip");
            }, teaseMs);
          }
        } else if (s === "failed") {
          if (connected) skip(); // the partner went away mid-call
          else if (role === "offerer" && !restarted) void restartIce();
        } else if (s === "closed") {
          skip();
        }
      };

      // Not connected 8s after matching: one ICE restart, then give up and move on.
      later(() => {
        if (!alive() || connected) return;
        if (!conn.remoteDescription) return fail(); // the partner never showed up
        void restartIce();
        later(() => {
          if (alive() && !connected) {
            timeline.patch({ note: "not connected after ICE restart: moved on" });
            fail();
          }
        }, GIVE_UP_AFTER_RESTART_MS);
      }, RESTART_AFTER_MS);

      // Server heartbeat: keeps the match alive and tells us if the partner left.
      const beat = async () => {
        if (!alive()) return;
        const { data } = await api<{ ended?: boolean }>("/api/match/heartbeat", { matchId: mid }).catch(() => ({ data: {} as { ended?: boolean } }));
        if (!alive()) return;
        if (data.ended) return skip();
        later(beat, CALL_HEARTBEAT_MS);
      };
      later(beat, CALL_HEARTBEAT_MS);

      // Chat text travels over the data channel; the partner closing it means they left.
      const onChannel = (c: RTCDataChannel) => {
        wireChannel(c);
        c.onclose = () => skip();
      };

      // The offerer is fixed by the server (the person who joined second), so both sides
      // never offer at once. It starts the offer right away so ICE gathering begins now,
      // and sends it as soon as the partner is listening on the channel.
      let offerReady: Promise<void> = Promise.resolve();
      let offered = false;
      if (role === "offerer") {
        onChannel(conn.createDataChannel("chat"));
        offerReady = conn.createOffer().then((o) => conn.setLocalDescription(o));
      } else {
        conn.ondatachannel = (e) => onChannel(e.channel);
      }
      const peerHere = async () => {
        if (role !== "offerer" || offered) return;
        offered = true;
        await offerReady;
        if (!alive()) return;
        send({ type: "offer", sdp: conn.localDescription!.toJSON() });
        timeline.mark("offer");
        flushOut();
      };

      const handle = async (m: Sig) => {
        switch (m.type) {
          case "hello":
            send({ type: "hello-ack" });
            return peerHere();
          case "hello-ack":
            return peerHere();
          case "bye":
            return skip();
          case "ice":
            if (conn.remoteDescription) await conn.addIceCandidate(m.candidate).catch(() => {});
            else inIce.push(m.candidate);
            return;
          case "offer":
            if (role !== "answerer") return;
            timeline.mark("offer");
            await conn.setRemoteDescription(m.sdp);
            await flushIn();
            await conn.setLocalDescription(await conn.createAnswer());
            send({ type: "answer", sdp: conn.localDescription!.toJSON() });
            timeline.mark("answer");
            flushOut();
            return;
          case "answer":
            if (role !== "offerer" || conn.signalingState !== "have-local-offer") return;
            timeline.mark("answer");
            await conn.setRemoteDescription(m.sdp);
            await flushIn();
            return;
        }
      };
      let chain = Promise.resolve();
      ch.on("broadcast", { event: "sig" }, ({ payload }) => {
        chain = chain.then(() => (alive() ? handle(payload as Sig) : undefined)).catch(() => {});
      });
      ch.subscribe((status) => {
        if (!alive()) return;
        if (status === "SUBSCRIBED") send({ type: "hello" });
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          timeline.patch({ note: `match channel ${status}` });
          fail();
        }
      });
    },
    [closePeer, ensureRealtime, wireChannel],
  );

  const start = useCallback(async () => {
    timeline.begin();
    setError(null);
    setPaywall(null);
    active.current = true;
    closePeer();
    const realtimeReady = ensureRealtime();
    void getIce();
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
    prepareSpare();

    const check = (s: any) => {
      if (gen.current !== myGen) return true;
      if (s?.status === "matched") {
        timeline.mark("matched");
        timeline.patch({ role: s.role });
        onMatch.current = null;
        void beginPeer(s.matchId, s.role, s.blur ?? null, s.teaseMs ?? TEASE_SECONDS * 1000);
        return true;
      }
      return false;
    };
    // Armed before joining: a partner can pair with us before our join response returns.
    onMatch.current = check;
    // Make sure we can hear the "matched" notice before entering the queue (bounded wait).
    await Promise.race([realtimeReady, sleep(REALTIME_WAIT_MS)]);
    if (gen.current !== myGen) return;

    const joined = await api("/api/match/join", filterRef.current);
    if (gen.current !== myGen) return;
    const fail = (msg: string | null, paywallReason?: PaywallReason) => {
      active.current = false;
      onMatch.current = null;
      if (paywallReason) setPaywall(paywallReason);
      setError(msg);
      setPhase("idle");
    };
    if (joined.data?.error === "premium_required") return fail(null, "gender");
    if (joined.data?.error === "banned") return fail("Your access to RandomChat has been suspended.");
    if (joined.status !== 200) {
      return fail(joined.data?.error === "age_verification_required" ? "Please verify your age first." : "Could not join the queue.");
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
      later(poll, rt.current?.live ? QUEUE_HEARTBEAT_MS : QUEUE_POLL_MS);
    };
    later(poll, rt.current?.live ? QUEUE_HEARTBEAT_MS : QUEUE_POLL_MS);
  }, [beginPeer, closePeer, ensureMedia, ensureRealtime, prepareSpare]);
  startRef.current = start;

  const stop = useCallback(() => {
    active.current = false;
    onMatch.current = null;
    closePeer();
    spare.current?.close();
    spare.current = null;
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
    micWanted.current = !micWanted.current;
    applyMic();
    setMicOn(micWanted.current);
  }, []);

  const toggleCam = useCallback(() => {
    const on = !camOn;
    local.current?.getVideoTracks().forEach((t) => (t.enabled = on));
    setCamOn(on);
  }, [camOn]);

  // Screech guard: while a call is live, a feedback howl mutes the mic for 3 seconds.
  const releaseEcho = useCallback(() => {
    clearTimeout(echoTimer.current);
    echoMuted.current = false;
    applyMic();
  }, []);
  useScreechGuard(localStream, phase === "connecting" || phase === "connected", () => {
    echoMuted.current = true;
    applyMic();
    setEchoWarning(true);
    clearTimeout(echoTimer.current);
    echoTimer.current = setTimeout(releaseEcho, 3000);
    timeline.patch({ note: "screech guard: mic muted 3s" });
  });
  const dismissEcho = useCallback(() => {
    releaseEcho();
    setEchoWarning(false);
  }, [releaseEcho]);

  /** Lets the page start Realtime + TURN while the age check / camera prompt is on screen. */
  const prewarm = useCallback(() => {
    void ensureRealtime();
    void getIce();
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
      spare.current?.close();
      spare.current = null;
      clearTimeout(echoTimer.current);
      local.current?.getTracks().forEach((t) => t.stop());
      local.current = null;
      void api("/api/match/leave", {});
      const r = rt.current;
      rt.current = null;
      rtPromise.current = null;
      if (r) void r.sb.removeChannel(r.channel);
    };
  }, [closePeer]);

  return {
    phase, error, notice, paywall, setPaywall, limitEndsAt, blur, unlock, messages,
    localStream, localPreview, remoteStream, micOn, camOn, matchId, echoWarning, dismissEcho,
    prewarm, start, stop, next, sendMessage, report, toggleMic, toggleCam,
  };
}
