import { NextResponse } from "next/server";
import { z } from "zod";
import { markConnected } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ matchId: z.string().uuid() });

/**
 * Client reports its media connection is up. A referral is credited later, when this chat
 * ends after lasting 60s+ with someone other than the inviter (see rc_end_match).
 */
export async function POST(req: Request) {
  const u = await getUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await markConnected(parsed.data.matchId, u.id);
  return NextResponse.json({ ok: true });
}
