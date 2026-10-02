import "server-only";
import { createHash } from "crypto";
import { isProd } from "./env";
import { profileToUser, type ProfileRow, type User } from "./entitlements";
import { FREE_MATCHES, REFERRAL, TEASE_SECONDS, type GenderFilter, type PayMethod, type ProductId } from "./plans";
import { supabaseAdmin } from "./supabase";

/**
 * Data access. Postgres is the single source of truth: every function here is a
 * call to a server-only SQL function (supabase/app.sql), executed with the
 * service-role key, so every Vercel instance sees the same queue, matches,
 * signals, orders and entitlements.
 */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

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

// ── PesaPal orders ──────────────────────────────────────────────────────────

export type OrderStatus = "pending" | "completed" | "failed" | "reversed";
export type Order = {
  merchant_reference: string;
  user_id: string;
  product: ProductId;
  method: PayMethod;
  currency: "USD" | "KES";
  amount: number;
  status: OrderStatus;
  order_tracking_id: string | null;
};

export const createOrder = (o: { merchantReference: string; userId: string; product: ProductId; method: PayMethod; currency: string; amount: number }) =>
  rpc<void>("rc_create_order", {
    p_merchant: o.merchantReference, p_user: o.userId, p_product: o.product,
    p_method: o.method, p_currency: o.currency, p_amount: o.amount,
  });

export const setOrderTracking = (merchantReference: string, trackingId: string) =>
  rpc<void>("rc_set_order_tracking", { p_merchant: merchantReference, p_tracking: trackingId });

/** Look up by our merchant reference, or (fallback) PesaPal's tracking id. */
export function getOrder(by: { merchantReference?: string | null; trackingId?: string | null }) {
  const args: Record<string, unknown> = {};
  if (by.merchantReference) args.p_merchant = by.merchantReference;
  else if (by.trackingId) args.p_tracking = by.trackingId;
  else return Promise.resolve(null);
  return rpc<Order | null>("rc_get_order", args);
}

export const markOrder = (merchantReference: string, status: "failed" | "reversed") =>
  rpc<void>("rc_mark_order", { p_merchant: merchantReference, p_status: status });

export type FulfilResult =
  | { ok: true; already: boolean; product: ProductId; user_id: string }
  | { ok: false; reason: "not_found" | "mismatch" };

/** Grants the entitlement exactly once for a payment PesaPal has already confirmed. */
export const fulfilOrder = (a: { merchantReference: string; trackingId: string; amount: number; currency: string; days: number; hours: number }) =>
  rpc<FulfilResult>("rc_fulfill_order", {
    p_merchant: a.merchantReference, p_tracking: a.trackingId, p_amount: a.amount,
    p_currency: a.currency, p_days: a.days, p_hours: a.hours,
  });

export const getSetting = (key: string) => rpc<string | null>("rc_get_setting", { p_key: key });
export const setSetting = (key: string, value: string) => rpc<void>("rc_set_setting", { p_key: key, p_value: value });

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

export const dailyMaintenance = () =>
  rpc<{ expired: number; users: number; reports: number }>("rc_daily_maintenance", {});
