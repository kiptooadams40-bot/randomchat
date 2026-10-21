import { NextResponse } from "next/server";
import { freeAllowance, isPremium, isVip } from "@/lib/entitlements";
import { listSessions } from "@/lib/repo";
import { getUser } from "@/lib/session";
import { describeDevice } from "@/lib/ua";

export const dynamic = "force-dynamic";

/** Everything the Account page shows. Devices list device type, browser and last active only. */
export async function GET() {
  const u = await getUser();
  const devices = u.anonymous
    ? []
    : (await listSessions(u.id)).map((s) => ({
        ...describeDevice(s.user_agent),
        lastActive: s.last_active,
        current: s.id === u.sessionId,
      }));
  return NextResponse.json(
    {
      signedIn: !u.anonymous,
      email: u.anonymous ? null : u.email,
      premium: isPremium(u),
      plan: u.plan,
      planExpiresAt: u.planExpiresAt,
      vip: isVip(u),
      vipUntil: u.vipUntil,
      matchesUsed: u.matchesTotal,
      freeAllowance: freeAllowance(u),
      ageVerified: u.ageVerified,
      devices,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
