import { createHash } from "crypto";
import { isProd } from "./env";
import { REFERRAL } from "./plans";
import { db, grantFixedVip, type User } from "./store";

/** Reward tiers are one-time and cumulative: 10 referrals = +5 matches, 20 = +10 more. */
function applyTiers(r: User) {
  if (!r.tier1Awarded && r.referralCount >= REFERRAL.tier1.referrals) {
    r.tier1Awarded = true;
    r.bonusMatches += REFERRAL.tier1.bonusMatches;
  }
  if (!r.tier2Awarded && r.referralCount >= REFERRAL.tier2.referrals) {
    r.tier2Awarded = true;
    r.bonusMatches += REFERRAL.tier2.bonusMatches;
  }
}

export function hashIp(ip: string) {
  return createHash("sha256").update((process.env.IP_HASH_SALT ?? "dev-salt") + ip).digest("hex");
}

/**
 * A referral counts as "successful" when the referred user is age-verified and
 * actually connects to their first chat. In production, one credit per hashed
 * IP per referrer (blunts self-referral farming; disabled in dev where every
 * test client shares localhost).
 */
export function creditReferralOnConnect(u: User, ipHash: string) {
  if (!u.referredBy || u.referralCredited || !u.ageVerified) return;
  const r = db.users.get(u.referredBy);
  if (!r || r.id === u.id) return;
  if (isProd) {
    const key = `${r.id}:${ipHash}`;
    if (db.referralIps.has(key)) return;
    db.referralIps.add(key);
  }
  u.referralCredited = true;
  r.referralCount++;
  applyTiers(r);
}

/**
 * Called on every authenticated request. Accumulates "active" time for users
 * who are actually using the app (gaps > 30s don't count), and awards the
 * referrer's engagement bonus once 20 referred users passed 10 active minutes.
 */
export function touchActivity(u: User) {
  const now = Date.now();
  const delta = now - u.lastActive;
  u.lastActive = now;
  if (delta < 30_000) u.activeMs += delta;

  if (u.referralCredited && !u.engagementCounted && u.activeMs >= REFERRAL.engagement.minutes * 60_000) {
    u.engagementCounted = true;
    const r = u.referredBy ? db.users.get(u.referredBy) : undefined;
    if (r) {
      r.engagedCount++;
      if (!r.engagementAwarded && r.engagedCount >= REFERRAL.engagement.users) {
        r.engagementAwarded = true;
        grantFixedVip(r.id, REFERRAL.engagement.vipHours, `engagement_${r.id}`);
      }
    }
  }
}
