import { NextResponse } from "next/server";
import { creditReferralOnConnect, hashIp } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Client reports its first media connection is up: this is what makes a referral "successful". */
export async function POST(req: Request) {
  const u = await getUser();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await creditReferralOnConnect(u.id, hashIp(ip));
  return NextResponse.json({ ok: true });
}
