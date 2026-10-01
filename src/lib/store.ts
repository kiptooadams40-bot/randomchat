import { randomBytes, randomUUID } from "crypto";
import {
  FREE_MATCHES,
  TEASE_SECONDS,
  getPlan,
  type Gender,
  type GenderFilter,
  type PlanId,
} from "./plans";

/**
 * In-memory mock database + matching queue + signaling inboxes.
 * Lives on globalThis so it survives Next dev hot reloads. It is for local
 * development only: it does not work across serverless instances. Swap for
 * Supabase (users/reports/referrals) and Upstash Redis (queue/signals) before launch.
 */

export type User = {
  id: string;
  ageVerified: boolean;
  gender: Gender | null;
  country: string | null; // self-declared ISO code
  plan: PlanId | null;
  planBilling: "recurring" | "once" | null;
  planExpiresAt: number | null;
  vipUntil: number | null; // VIP pass (bought or earned)
  stripeCustomerId: string | null;
  matchesTotal: number; // lifetime matches started
  bonusMatches: number; // extra free matches earned via referrals
  // referrals
  referralCode: string;
  referredBy: string | null; // referrer's user id
  referralCredited: boolean;
  engagementCounted: boolean;
  referralCount: number;
  engagedCount: number;
  tier1Awarded: boolean;
  tier2Awarded: boolean;
  engagementAwarded: boolean;
  activeMs: number;
  lastActive: number;
};

export type BlurMode = "tease" | "location" | null;

export type Match = {
  id: string;
  a: string; // offerer
  b: string; // answerer
  createdAt: number;
  seen: Record<string, number>;
  blur: Record<string, BlurMode>; // per-user paywall treatment for this match
};

export type SignalMsg = { type: "offer" | "answer" | "ice"; payload: unknown };

type QueueEntry = {
  userId: string;
  lastSeen: number;
  filter: GenderFilter;
  countryFilter: string; // "any" | ISO code
};

type Report = { id: string; matchId: string; reporter: string; reported: string; reason: string; at: number };
type StkRequest = { id: string; userId: string; createdAt: number; done: boolean };

type DB = {
  users: Map<string, User>;
  codes: Map<string, string>; // referral code -> user id
  queue: QueueEntry[];
  matches: Map<string, Match>;
  userMatch: Map<string, string>;
  inbox: Map<string, SignalMsg[]>; // key `${matchId}:${userId}`
  reports: Report[];
  processedPayments: Set<string>;
  referralIps: Set<string>; // `${referrerId}:${ipHash}`
  stk: Map<string, StkRequest>;
};

const g = globalThis as unknown as { __rcdb?: DB };
export const db: DB = (g.__rcdb ??= {
  users: new Map(),
  codes: new Map(),
  queue: [],
  matches: new Map(),
  userMatch: new Map(),
  inbox: new Map(),
  reports: [],
  processedPayments: new Set(),
  referralIps: new Set(),
  stk: new Map(),
});

const QUEUE_TTL = 15_000;
const MATCH_TTL = 20_000;

export function createUser(id: string, referredBy: string | null = null): User {
  const code = randomBytes(4).toString("hex");
  const u: User = {
    id, ageVerified: false, gender: null, country: null,
    plan: null, planBilling: null, planExpiresAt: null, vipUntil: null, stripeCustomerId: null,
    matchesTotal: 0, bonusMatches: 0,
    referralCode: code, referredBy, referralCredited: false, engagementCounted: false,
    referralCount: 0, engagedCount: 0,
    tier1Awarded: false, tier2Awarded: false, engagementAwarded: false,
    activeMs: 0, lastActive: Date.now(),
  };
  db.users.set(id, u);
  db.codes.set(code, id);
  return u;
}

export function normalizeUser(u: User): User {
  if (u.plan && u.planExpiresAt && u.planExpiresAt < Date.now()) {
    u.plan = null;
    u.planBilling = null;
    u.planExpiresAt = null;
  }
  if (u.vipUntil && u.vipUntil < Date.now()) u.vipUntil = null;
  return u;
}

export const isPremium = (u: User) => !!u.plan && !!u.planExpiresAt && u.planExpiresAt > Date.now();
export const isVip = (u: User) => !!u.vipUntil && u.vipUntil > Date.now();
/** Premium or VIP: no blur, no tease, location filter unlocked. Gender filter still needs Premium. */
export const hasAccess = (u: User) => isPremium(u) || isVip(u);

export const freeAllowance = (u: User) => FREE_MATCHES + u.bonusMatches;
export const freeMatchesLeft = (u: User) => (hasAccess(u) ? null : Math.max(0, freeAllowance(u) - u.matchesTotal));

export function activatePlan(
  userId: string,
  planId: PlanId,
  paymentRef: string,
  billing: "recurring" | "once" = "recurring",
) {
  if (db.processedPayments.has(paymentRef)) return; // idempotent (webhook + redirect + renewals)
  const plan = getPlan(planId);
  const u = db.users.get(userId);
  if (!plan || !u) return;
  db.processedPayments.add(paymentRef);
  const base = isPremium(u) ? u.planExpiresAt! : Date.now();
  u.plan = plan.id;
  u.planBilling = billing;
  u.planExpiresAt = base + plan.days * 86_400_000;
}

export function grantVip(userId: string, hours: number, ref: string) {
  if (db.processedPayments.has(ref)) return;
  const u = db.users.get(userId);
  if (!u) return;
  db.processedPayments.add(ref);
  const base = isVip(u) ? u.vipUntil! : Date.now();
  u.vipUntil = base + hours * 3_600_000;
}

/**
 * Fixed-expiry VIP grant (referral engagement bonus). The pass ends at exactly
 * unlock time + `hours`, stored as an absolute timestamp: it keeps running
 * whether or not the user is online or chatting, and is never a bank of usage
 * time. It doesn't stack onto an existing pass; if the user already holds a
 * VIP pass that ends later, that longer expiry is kept.
 */
export function grantFixedVip(userId: string, hours: number, ref: string) {
  if (db.processedPayments.has(ref)) return;
  const u = db.users.get(userId);
  if (!u) return;
  db.processedPayments.add(ref);
  const expiresAt = Date.now() + hours * 3_600_000;
  u.vipUntil = Math.max(u.vipUntil ?? 0, expiresAt);
}

// ── Matching ────────────────────────────────────────────────────────────────

function sweep() {
  const now = Date.now();
  db.queue = db.queue.filter((q) => now - q.lastSeen < QUEUE_TTL);
  for (const m of [...db.matches.values()]) {
    const stale = Math.min(m.seen[m.a] ?? 0, m.seen[m.b] ?? 0);
    if (now - stale > MATCH_TTL) endMatch(m.id);
  }
}

export function endMatch(matchId: string) {
  const m = db.matches.get(matchId);
  if (!m) return;
  db.matches.delete(matchId);
  for (const uid of [m.a, m.b]) {
    if (db.userMatch.get(uid) === matchId) db.userMatch.delete(uid);
    db.inbox.delete(`${matchId}:${uid}`);
  }
}

export type MatchState =
  | { status: "waiting" }
  | { status: "matched"; matchId: string; role: "offerer" | "answerer"; blur: BlurMode; teaseMs: number };

function stateFor(userId: string): MatchState {
  const mid = db.userMatch.get(userId);
  const m = mid ? db.matches.get(mid) : undefined;
  if (!m) return { status: "waiting" };
  return {
    status: "matched",
    matchId: m.id,
    role: m.a === userId ? "offerer" : "answerer",
    blur: m.blur[userId] ?? null,
    teaseMs: TEASE_SECONDS * 1000,
  };
}

const genderOk = (f: GenderFilter, g: Gender | null) =>
  f === "both" || (f === "boys" && g === "boy") || (f === "girls" && g === "girl");

const countryOk = (f: string, c: string | null) => f === "any" || f === c;

export function joinQueue(user: User, filter: GenderFilter, countryFilter: string): MatchState {
  sweep();
  if (db.userMatch.has(user.id)) return stateFor(user.id);
  const now = Date.now();
  // Filters are mutual: I must accept them and they must accept me.
  const other = db.queue.find((q) => {
    if (q.userId === user.id) return false;
    const peer = db.users.get(q.userId);
    return (
      !!peer &&
      genderOk(filter, peer.gender) && genderOk(q.filter, user.gender) &&
      countryOk(countryFilter, peer.country) && countryOk(q.countryFilter, user.country)
    );
  });
  if (other) {
    db.queue = db.queue.filter((q) => q.userId !== other.userId && q.userId !== user.id);
    const m: Match = {
      id: randomUUID(),
      a: other.userId,
      b: user.id,
      createdAt: now,
      seen: { [other.userId]: now, [user.id]: now },
      blur: {},
    };
    const cf: Record<string, string> = { [other.userId]: other.countryFilter, [user.id]: countryFilter };
    for (const uid of [m.a, m.b]) {
      const u = db.users.get(uid);
      if (!u) continue;
      // Decided before counting this match. Access holders are never blurred.
      m.blur[uid] = hasAccess(u)
        ? null
        : cf[uid] !== "any"
          ? "location" // free user searched by region: blurred from the start
          : u.matchesTotal >= freeAllowance(u)
            ? "tease" // match 8+: 10s clear, then blurred
            : null;
      u.matchesTotal++;
    }
    db.matches.set(m.id, m);
    db.userMatch.set(m.a, m.id);
    db.userMatch.set(m.b, m.id);
    return stateFor(user.id);
  }
  const existing = db.queue.find((q) => q.userId === user.id);
  if (existing) {
    existing.lastSeen = now;
    existing.filter = filter;
    existing.countryFilter = countryFilter;
  } else db.queue.push({ userId: user.id, lastSeen: now, filter, countryFilter });
  return { status: "waiting" };
}

export function pollMatch(userId: string): MatchState {
  sweep();
  const q = db.queue.find((x) => x.userId === userId);
  if (q) q.lastSeen = Date.now();
  return stateFor(userId);
}

export function leave(userId: string) {
  db.queue = db.queue.filter((q) => q.userId !== userId);
  const mid = db.userMatch.get(userId);
  if (mid) endMatch(mid);
}

export function peerOf(matchId: string, userId: string): string | null {
  const m = db.matches.get(matchId);
  if (!m || (m.a !== userId && m.b !== userId)) return null;
  return m.a === userId ? m.b : m.a;
}

// ── Signaling ───────────────────────────────────────────────────────────────

export function pushSignal(matchId: string, from: string, msg: SignalMsg): boolean {
  const peer = peerOf(matchId, from);
  if (!peer) return false;
  const key = `${matchId}:${peer}`;
  const box = db.inbox.get(key) ?? [];
  box.push(msg);
  db.inbox.set(key, box);
  return true;
}

/** Returns queued messages, or null when the match has ended. */
export function drainSignals(matchId: string, userId: string): SignalMsg[] | null {
  const m = db.matches.get(matchId);
  if (!m || (m.a !== userId && m.b !== userId)) return null;
  m.seen[userId] = Date.now();
  const key = `${matchId}:${userId}`;
  const box = db.inbox.get(key) ?? [];
  db.inbox.delete(key);
  return box;
}

export function addReport(matchId: string, reporter: string, reason: string) {
  const reported = peerOf(matchId, reporter);
  if (!reported) return false;
  db.reports.push({ id: randomUUID(), matchId, reporter, reported, reason, at: Date.now() });
  return true;
}

export function dailyMaintenance() {
  let expired = 0;
  for (const u of db.users.values()) {
    const had = u.plan;
    normalizeUser(u);
    if (had && !u.plan) expired++;
  }
  sweep();
  return { expired, users: db.users.size, reports: db.reports.length };
}
