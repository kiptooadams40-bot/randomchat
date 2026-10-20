/**
 * Connection timing for the ?debug=1 overlay. Records when each step of a match happened
 * (relative to the Start / Next tap) and which ICE candidate types the call ended up using.
 * Pure client-side bookkeeping: nothing here is sent anywhere.
 */

export type Step = "start" | "joined" | "matched" | "offer" | "answer" | "iceConnected" | "firstFrame";
export const STEPS: Step[] = ["start", "joined", "matched", "offer", "answer", "iceConnected", "firstFrame"];

export type Run = {
  t0: number;
  role: "offerer" | "answerer" | null;
  steps: Partial<Record<Step, number>>; // ms since t0
  local: string | null; // host | srflx | prflx | relay
  remote: string | null;
  protocol: string | null; // udp | tcp (relay protocol when relayed)
  rttMs: number | null;
  note: string | null;
};

/** Per-page facts: whether TURN credentials came back, and the mic processing actually in effect. */
export type Env = { turn: boolean | null; audio: string | null };

type State = { current: Run | null; history: Run[]; env: Env };

let state: State = { current: null, history: [], env: { turn: null, audio: null } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const timeline = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,

  /** Start / Next tapped: archive the previous run and start a fresh one. */
  begin() {
    const history = state.current ? [state.current, ...state.history].slice(0, 5) : state.history;
    state = {
      current: { t0: performance.now(), role: null, steps: { start: 0 }, local: null, remote: null, protocol: null, rttMs: null, note: null },
      history,
      env: state.env,
    };
    emit();
  },

  setEnv(p: Partial<Env>) {
    state = { ...state, env: { ...state.env, ...p } };
    emit();
  },

  /** First mark of a step wins (renegotiation / duplicates don't move it). */
  mark(step: Step) {
    const c = state.current;
    if (!c || c.steps[step] !== undefined) return;
    state = { ...state, current: { ...c, steps: { ...c.steps, [step]: Math.round(performance.now() - c.t0) } } };
    emit();
  },

  patch(p: Partial<Omit<Run, "t0" | "steps">>) {
    if (!state.current) return;
    state = { ...state, current: { ...state.current, ...p } };
    emit();
  },
};

/** Reads the selected candidate pair from getStats(): host / srflx / relay on each side. */
export async function recordCandidatePair(pc: RTCPeerConnection) {
  try {
    const stats = await pc.getStats();
    let pairId: string | undefined;
    stats.forEach((s: any) => {
      if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    let pair: any;
    stats.forEach((s: any) => {
      if (s.type !== "candidate-pair") return;
      if (pairId ? s.id === pairId : s.nominated && s.state === "succeeded") pair = s;
    });
    if (!pair) return;
    const local: any = stats.get(pair.localCandidateId);
    const remote: any = stats.get(pair.remoteCandidateId);
    timeline.patch({
      local: local?.candidateType ?? null,
      remote: remote?.candidateType ?? null,
      protocol: local?.relayProtocol ?? local?.protocol ?? null,
      rttMs: typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null,
    });
  } catch {
    /* stats unavailable: overlay just shows "?" */
  }
}
