import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { freeMatchesLeft, isPremium, isVip } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  return NextResponse.json({
    ageVerified: u.ageVerified,
    gender: u.gender,
    country: u.country,
    premium: isPremium(u),
    plan: u.plan,
    planExpiresAt: u.planExpiresAt,
    vip: isVip(u),
    vipUntil: u.vipUntil,
    freeMatchesLeft: freeMatchesLeft(u),
  });
}
