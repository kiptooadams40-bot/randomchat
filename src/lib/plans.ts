export type PlanId = "weekly" | "fortnightly" | "monthly";

export type Plan = {
  id: PlanId;
  name: string;
  days: number;
  priceCents: number;
  interval: { unit: "week" | "month"; count: number }; // Stripe recurring interval
  blurb: string;
};

/** How a Premium plan is paid: auto-renewing subscription, or a single payment for one duration. */
export type Billing = "recurring" | "once";

/** Standard Premium store: each plan can be bought either way at the same price. The VIP pass is NOT listed here. */
export const PLANS: Plan[] = [
  { id: "weekly", name: "Weekly", days: 7, priceCents: 499, interval: { unit: "week", count: 1 }, blurb: "Billed every week" },
  { id: "fortnightly", name: "Fortnightly", days: 14, priceCents: 899, interval: { unit: "week", count: 2 }, blurb: "Billed every 2 weeks" },
  { id: "monthly", name: "Monthly", days: 30, priceCents: 1499, interval: { unit: "month", count: 1 }, blurb: "Best value · billed monthly" },
];

/** Flash-deal one-time pass, only offered from the blur paywalls. Priced in USD. */
export const VIP_PASS = { id: "vip24", name: "24-Hour VIP Pass", hours: 24, priceCents: 55 } as const;
export type ProductId = PlanId | typeof VIP_PASS.id;

/** Matches 1..7 are fully free (plus referral bonuses); after that the 10s tease + blur applies. */
export const FREE_MATCHES = 7;
export const TEASE_SECONDS = 10;

export const REFERRAL = {
  tier1: { referrals: 10, bonusMatches: 5 },
  tier2: { referrals: 20, bonusMatches: 10 },
  engagement: { users: 20, minutes: 10, vipHours: 1 },
} as const;

/** Self-declared, optional; only used for the Premium Boys / Girls / Both filter. */
export type Gender = "boy" | "girl";
export type GenderFilter = "both" | "boys" | "girls";

export const GENDER_FILTERS: [GenderFilter, string][] = [
  ["both", "Both"],
  ["boys", "Boys"],
  ["girls", "Girls"],
];

export function getPlan(id: unknown): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
