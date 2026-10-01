import { FREE_MATCHES, type Billing, type Gender, type PlanId } from "./plans";

/** A user as the app sees it (mapped from the Supabase `profiles` row). */
export type User = {
  id: string;
  ageVerified: boolean;
  gender: Gender | null;
  country: string | null;
  plan: PlanId | null;
  planBilling: Billing | null;
  planExpiresAt: number | null; // epoch ms
  vipUntil: number | null; // epoch ms (absolute expiry)
  matchesTotal: number;
  bonusMatches: number;
  referralCode: string;
  referralCredited: boolean;
  engagementCounted: boolean;
  referralCount: number;
  engagedCount: number;
  tier1Awarded: boolean;
  tier2Awarded: boolean;
  engagementAwarded: boolean;
};

/** Raw snake_case row returned by rc_get_profile. */
export type ProfileRow = {
  id: string;
  age_verified: boolean;
  gender: Gender | null;
  country: string | null;
  plan: PlanId | null;
  plan_billing: Billing | null;
  plan_expires_at: string | null;
  vip_until: string | null;
  matches_total: number;
  bonus_matches: number;
  referral_code: string;
  referral_credited: boolean;
  engagement_counted: boolean;
  referral_count: number;
  engaged_count: number;
  tier1_awarded: boolean;
  tier2_awarded: boolean;
  engagement_awarded: boolean;
};

const ms = (t: string | null) => (t ? new Date(t).getTime() : null);

export function profileToUser(r: ProfileRow): User {
  const planExpiresAt = ms(r.plan_expires_at);
  const vipUntil = ms(r.vip_until);
  const planActive = !!planExpiresAt && planExpiresAt > Date.now();
  return {
    id: r.id,
    ageVerified: r.age_verified,
    gender: r.gender,
    country: r.country,
    plan: planActive ? r.plan : null,
    planBilling: planActive ? r.plan_billing : null,
    planExpiresAt: planActive ? planExpiresAt : null,
    vipUntil: vipUntil && vipUntil > Date.now() ? vipUntil : null,
    matchesTotal: r.matches_total,
    bonusMatches: r.bonus_matches,
    referralCode: r.referral_code,
    referralCredited: r.referral_credited,
    engagementCounted: r.engagement_counted,
    referralCount: r.referral_count,
    engagedCount: r.engaged_count,
    tier1Awarded: r.tier1_awarded,
    tier2Awarded: r.tier2_awarded,
    engagementAwarded: r.engagement_awarded,
  };
}

export const isPremium = (u: User) => !!u.planExpiresAt && u.planExpiresAt > Date.now();
export const isVip = (u: User) => !!u.vipUntil && u.vipUntil > Date.now();
/** Premium or VIP: no blur, no tease, location filter unlocked. Gender filter still needs Premium. */
export const hasAccess = (u: User) => isPremium(u) || isVip(u);

export const freeAllowance = (u: User) => FREE_MATCHES + u.bonusMatches;
export const freeMatchesLeft = (u: User) => (hasAccess(u) ? null : Math.max(0, freeAllowance(u) - u.matchesTotal));
