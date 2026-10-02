export type PlanId = "weekly" | "fortnightly" | "monthly";
export type PayMethod = "card" | "mpesa";

export type Plan = {
  id: PlanId;
  name: string;
  days: number;
  priceCents: number; // USD cents, charged to cards
  kes: number; // whole KES, charged via M-Pesa
  blurb: string;
};

/** Premium store. One-time payments: nothing renews. The VIP pass is NOT listed here. */
export const PLANS: Plan[] = [
  { id: "weekly", name: "Weekly", days: 7, priceCents: 499, kes: 650, blurb: "7 days of Premium" },
  { id: "fortnightly", name: "Fortnightly", days: 14, priceCents: 899, kes: 1170, blurb: "14 days of Premium" },
  { id: "monthly", name: "Monthly", days: 30, priceCents: 1499, kes: 1950, blurb: "30 days · best value" },
];

/** Flash-deal pass, only offered from the blur paywalls. */
export const VIP_PASS = { id: "vip24", name: "24-Hour VIP Pass", hours: 24, priceCents: 55, kes: 70 } as const;
export type ProductId = PlanId | typeof VIP_PASS.id;

export const PRODUCT_IDS = ["weekly", "fortnightly", "monthly", "vip24"] as const;
export const PAY_METHODS = ["card", "mpesa"] as const;

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

export function formatKes(kes: number) {
  return `KES ${kes.toLocaleString("en-US")}`;
}

export type Quote = {
  product: ProductId;
  method: PayMethod;
  currency: "USD" | "KES";
  amount: number; // what PesaPal is asked to charge (USD with cents, or whole KES)
  display: string; // "$4.99" | "KES 650"
  description: string;
};

/**
 * The ONLY place amounts are decided. The browser sends just {product, method};
 * cards are charged in USD, M-Pesa strictly in KES.
 */
export function quote(product: ProductId, method: PayMethod): Quote {
  const isVip = product === VIP_PASS.id;
  const plan = isVip ? undefined : getPlan(product);
  if (!isVip && !plan) throw new Error(`unknown product: ${product}`);
  const usdCents = isVip ? VIP_PASS.priceCents : plan!.priceCents;
  const kes = isVip ? VIP_PASS.kes : plan!.kes;
  const name = isVip ? VIP_PASS.name : `Premium ${plan!.name} (${plan!.days} days)`;
  return method === "card"
    ? { product, method, currency: "USD", amount: usdCents / 100, display: formatPrice(usdCents), description: `RandomChat ${name}` }
    : { product, method, currency: "KES", amount: kes, display: formatKes(kes), description: `RandomChat ${name}` };
}
