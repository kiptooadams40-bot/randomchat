import { NextResponse } from "next/server";
import { creditReferralOnConnect, hashIp } from "@/lib/referrals";
import { getUser } from "@/lib/session";

/** Client reports its first media connection is up: this is what makes a referral "successful". */
export async function POST(req: Request) {
  const u = await getUser();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  creditReferralOnConnect(u, hashIp(ip));
  return NextResponse.json({ ok: true });
}
