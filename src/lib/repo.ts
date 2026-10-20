import "server-only";
import { profileToUser, type ProfileRow, type User } from "./entitlements";
import { FREE_MATCHES, REFERRAL, TEASE_SECONDS, type GenderFilter, type PayMethod, type ProductId } from "./plans";
import { supabaseAdmin } from "./supabase";

/**
 * Data access. Postgres is the single source of truth: every function here is a
 * call to a server-only SQL function (supabase/app.sql + supabase/identity.sql),
 * executed with the secret key, so every Vercel instance sees the same queue,
 * matches, orders and entitlements.
 */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export type BlurMode = "tease" | "location" | null;
export type MatchState =
  | { status: "waiting" }
  | { status: "banned" }
  | { status: "matched"; matchId: string; role: "offerer" | "answerer"; blur: BlurMode; teaseMs: number };

// ── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(uid: string): Promise<User | null> {
  const row = await rpc<ProfileRow | null>("rc_get_profile", { p_user: uid });
  return row ? profileToUser(row) : null;
}

/** Profile plus whether this JWT's session still exists (revoked by "Sign out of all devices"). */
export async function loadUser(uid: string, sessionId: string | null) {
  const row = await rpc<(ProfileRow & { session_ok: boolean; banned: boolean }) | null>("rc_load_user", {
    p_user: uid,
    p_session: sessionId,
  });
  return row ? { user: profileToUser(row), sessionOk: row.session_ok, banned: row.banned } : null;
}

export const updateProfile = (uid: string, patch: { gender?: string | null; country?: string | null }) =>
  rpc<void>("rc_update_profile", { p_user: uid, p_patch: patch });

export const setAgeVerified = (uid: string) => rpc<void>("rc_set_age_verified", { p_user: uid });

export const setReferrer = (uid: string, code: string) => rpc<void>("rc_set_referrer", { p_user: uid, p_code: code });
export const referrerExists = (code: string) => rpc<boolean>("rc_referrer_exists", { p_code: code });

// ── Accounts ────────────────────────────────────────────────────────────────

/** Moves everything from an anonymous identity into a signed-in account (see rc_merge_users). */
export const mergeUsers = (from: string, into: string) => rpc<{ merged: boolean }>("rc_merge_users", { p_from: from, p_into: into });

export type DeviceSession = { id: string; user_agent: string | null; created_at: string; last_active: string };
export const listSessions = (uid: string) => rpc<DeviceSession[]>("rc_list_sessions", { p_user: uid });

export const prepareAccountDelete = (uid: string) => rpc<void>("rc_prepare_account_delete", { p_user: uid });

/** Fixed-window rate limit. Returns false once `max` is exceeded. cost 0 only checks. */
export const rateHit = (key: string, max: number, windowSeconds: number, cost = 1) =>
  rpc<boolean>("rc_rate_hit", { p_key: key, p_max: max, p_window_s: windowSeconds, p_cost: cost });
export const rateReset = (key: string) => rpc<void>("rc_rate_reset", { p_key: key });

// ── Matchmaking ─────────────────────────────────────────────────────────────

type RawState = { status: "waiting" } | { status: "banned" } | { status: "matched"; matchId: string; role: "offerer" | "answerer"; blur: BlurMode };
const withTease = (s: RawState): MatchState =>
  s.status === "matched" ? { ...s, teaseMs: TEASE_SECONDS * 1000 } : s;

/** Enqueue (or pair immediately with) a compatible waiting user. Atomic in Postgres. */
export async function joinQueue(uid: string, filter: GenderFilter, country: string): Promise<MatchState> {
  return withTease(await rpc<RawState>("rc_join_queue", { p_user: uid, p_filter: filter, p_country: country, p_free: FREE_MATCHES }));
}

/** Current match, and re-tries pairing while waiting (backup for the Broadcast notification). */
export async function pollMatch(uid: string): Promise<MatchState> {
  return withTease(await rpc<RawState>("rc_poll_match", { p_user: uid, p_free: FREE_MATCHES }));
}

export const leave = (uid: string) => rpc<void>("rc_leave", { p_user: uid });

/** In-call heartbeat: keeps the match alive and tells the client if it has ended. */
export const matchHeartbeat = (matchId: string, uid: string) =>
  rpc<{ ended: boolean }>("rc_match_heartbeat", { p_match: matchId, p_user: uid });

/** Media is up. A referral counts once the chat then lasts 60s+ (settled when it ends). */
export const markConnected = (matchId: string, uid: string) =>
  rpc<void>("rc_mark_connected", { p_match: matchId, p_user: uid });

export const addReport = (matchId: string, uid: string, reason: string) =>
  rpc<boolean>("rc_report", { p_match: matchId, p_reporter: uid, p_reason: reason });

// ── Orders ──────────────────────────────────────────────────────────────────

export type PaymentProvider = "pesapal" | "stripe" | "paypal";
export type OrderStatus = "pending" | "completed" | "failed" | "reversed";
export type Order = {
  merchant_reference: string;
  user_id: string | null;
  product: ProductId;
  method: PayMethod;
  currency: "USD" | "KES";
  amount: number;
  status: OrderStatus;
  provider: PaymentProvider;
  order_tracking_id: string | null;
  provider_txn_id: string | null;
};

export const createOrder = (o: {
  merchantReference: string; userId: string; product: ProductId; method: PayMethod;
  currency: string; amount: number; provider: PaymentProvider; email: string | null;
}) =>
  rpc<void>("rc_order_create", {
    p_merchant: o.merchantReference, p_user: o.userId, p_product: o.product,
    p_method: o.method, p_currency: o.currency, p_amount: o.amount,
    p_provider: o.provider, p_email: o.email,
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
  | { ok: false; reason: "not_found" | "mismatch" | "no_user" };

/** Grants exactly once for a payment the provider has ALREADY confirmed (rc_payment_fulfil). */
export const paymentFulfil = (a: {
  merchantReference: string; provider: PaymentProvider; txnId: string;
  amount: number; currency: string; days: number; hours: number;
}) =>
  rpc<FulfilResult>("rc_payment_fulfil", {
    p_merchant: a.merchantReference, p_provider: a.provider, p_txn: a.txnId, p_amount: a.amount,
    p_currency: a.currency, p_days: a.days, p_hours: a.hours,
  });

export const getSetting = (key: string) => rpc<string | null>("rc_get_setting", { p_key: key });
export const setSetting = (key: string, value: string) => rpc<void>("rc_set_setting", { p_key: key, p_value: value });

// ── Referrals ───────────────────────────────────────────────────────────────

/** Accumulates active time; awards the referrer's fixed-expiry engagement VIP pass. */
export const touchActivity = (uid: string) =>
  rpc<void>("rc_touch_activity", {
    p_user: uid, p_minutes: REFERRAL.engagement.minutes,
    p_users: REFERRAL.engagement.users, p_vip_hours: REFERRAL.engagement.vipHours,
  });

export const dailyMaintenance = () =>
  rpc<{ expired: number; users: number; reports: number }>("rc_daily_maintenance", {});
