import { NextResponse } from "next/server";
import { isVip } from "@/lib/entitlements";
import { appUrl } from "@/lib/env";
import { REFERRAL } from "@/lib/plans";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  return NextResponse.json({
    link: `${appUrl()}/r/${u.referralCode}`,
    referrals: u.referralCount,
    engaged: u.engagedCount,
    bonusMatches: u.bonusMatches,
    vip: isVip(u),
    vipUntil: u.vipUntil,
    milestones: REFERRAL,
    awarded: { tier1: u.tier1Awarded, tier2: u.tier2Awarded, engagement: u.engagementAwarded },
  });
}
