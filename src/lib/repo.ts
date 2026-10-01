import "server-only";
import { createHash } from "crypto";
import { isProd } from "./env";
import { profileToUser, type ProfileRow, type User } from "./entitlements";
import { FREE_MATCHES, REFERRAL, TEASE_SECONDS, VIP_PASS, getPlan, type Billing, type GenderFilter, type PlanId } from "./plans";
import { supabaseAdmin } from "./supabase";

/**
 * Data access. Postgres is the single source of truth: every function here is a
 * call to a server-only SQL function (supabase/matchmaking.sql), so every Vercel
 * instance sees the same queue, matches, signals and entitlements.
 */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export type Provider = "stripe" | "mpesa" | "mock";
export type BlurMode = "tease" | "location" | null;
export type MatchState =
  | { status: "waiting" }
  | { status: "matched"; matchId: string; role: "offerer" | "answerer"; blur: BlurMode; teaseMs: number };

export type SignalType = "offer" | "answer" | "ice";
export type DrainResult = { ended: true } | { messages: { type: SignalType; payload: unknown }[] };

// ── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(uid: string): Promise<User | null> {
  const row = await rpc<ProfileRow | null>("rc_get_profile", { p_user: uid });
  return row ? profileToUser(row) : null;
}

export const updateProfile = (uid: string, patch: { gender?: string | null; country?: string | null }) =>
  rpc<void>("rc_update_profile", { p_user: uid, p_patch: patch });

export const setAgeVerified = (uid: string) => rpc<void>("rc_set_age_verified", { p_user: uid });

export const setReferrer = (uid: string, code: string) => rpc<void>("rc_set_referrer", { p_user: uid, p_code: code });
export const referrerExists = (code: string) => rpc<boolean>("rc_referrer_exists", { p_code: code });

export const setStripeCustomer = (uid: string, customerId: string) =>
  rpc<void>("rc_set_stripe_customer", { p_user: uid, p_customer: customerId });
export const getStripeCustomer = (uid: string) => rpc<string | null>("rc_get_stripe_customer", { p_user: uid });

// ── Matchmaking ─────────────────────────────────────────────────────────────

type RawState = { status: "waiting" } | { status: "matched"; matchId: string; role: "offerer" | "answerer"; blur: BlurMode };
const withTease = (s: RawState): MatchState =>
  s.status === "matched" ? { ...s, teaseMs: TEASE_SECONDS * 1000 } : s;

/** Enqueue (or pair immediately with) a compatible waiting user. Atomic in Postgres. */
export async function joinQueue(uid: string, filter: GenderFilter, country: string): Promise<MatchState> {
  return withTease(await rpc<RawState>("rc_join_queue", { p_user: uid, p_filter: filter, p_country: country, p_free: FREE_MATCHES }));
}

/** Current match, and re-tries pairing while waiting. */
export async function pollMatch(uid: string): Promise<MatchState> {
  return withTease(await rpc<RawState>("rc_poll_match", { p_user: uid, p_free: FREE_MATCHES }));
}

export const leave = (uid: string) => rpc<void>("rc_leave", { p_user: uid });

// ── Signaling ───────────────────────────────────────────────────────────────

export const pushSignal = (matchId: string, uid: string, type: SignalType, payload: unknown) =>
  rpc<boolean>("rc_push_signal", { p_match: matchId, p_from: uid, p_type: type, p_payload: payload ?? null });

export const drainSignals = (matchId: string, uid: string) =>
  rpc<DrainResult>("rc_drain_signals", { p_match: matchId, p_user: uid });

export const addReport = (matchId: string, uid: string, reason: string) =>
  rpc<boolean>("rc_report", { p_match: matchId, p_reporter: uid, p_reason: reason });

// ── Entitlements (idempotent on `ref`) ──────────────────────────────────────

export function activatePlan(uid: string, planId: PlanId, ref: string, billing: Billing = "recurring", provider: Provider = "stripe") {
  const plan = getPlan(planId);
  if (!plan) return Promise.resolve(false);
  return rpc<boolean>("rc_activate_plan", {
    p_user: uid, p_plan: plan.id, p_ref: ref, p_billing: billing,
    p_days: plan.days, p_amount: plan.priceCents, p_provider: provider,
  });
}

/** Bought 24-Hour VIP Pass (stacks onto an active pass). */
export const grantVipPass = (uid: string, ref: string, provider: Provider = "stripe") =>
  rpc<boolean>("rc_grant_vip", {
    p_user: uid, p_hours: VIP_PASS.hours, p_ref: ref, p_kind: "vip_pass",
    p_provider: provider, p_fixed: false, p_amount: VIP_PASS.priceCents,
  });

// ── Referrals ───────────────────────────────────────────────────────────────

export const hashIp = (ip: string) =>
  createHash("sha256").update((process.env.IP_HASH_SALT ?? "dev-salt") + ip).digest("hex");

/**
 * A referral is "successful" once the referred user is age-verified and connects
 * to their first chat. In production, one credit per hashed IP per referrer.
 */
export const creditReferralOnConnect = (uid: string, ipHash: string) =>
  rpc<boolean>("rc_credit_referral", {
    p_user: uid, p_ip_hash: ipHash, p_enforce_ip: isProd,
    p_t1_refs: REFERRAL.tier1.referrals, p_t1_bonus: REFERRAL.tier1.bonusMatches,
    p_t2_refs: REFERRAL.tier2.referrals, p_t2_bonus: REFERRAL.tier2.bonusMatches,
  });

/** Accumulates active time; awards the referrer's fixed-expiry engagement VIP pass. */
export const touchActivity = (uid: string) =>
  rpc<void>("rc_touch_activity", {
    p_user: uid, p_minutes: REFERRAL.engagement.minutes,
    p_users: REFERRAL.engagement.users, p_vip_hours: REFERRAL.engagement.vipHours,
  });

// ── M-Pesa (simulation) / maintenance ───────────────────────────────────────

export const createMpesa = (uid: string) => rpc<string>("rc_mpesa_create", { p_user: uid });

export const mpesaStatus = (id: string, uid: string, delayMs: number) =>
  rpc<"pending" | "paid" | "failed" | null>("rc_mpesa_status", {
    p_id: id, p_user: uid, p_delay_ms: delayMs, p_hours: VIP_PASS.hours, p_amount: VIP_PASS.priceCents,
  });

export const dailyMaintenance = () =>
  rpc<{ expired: number; users: number; reports: number }>("rc_daily_maintenance", {});
