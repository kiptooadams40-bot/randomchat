import { NextResponse } from "next/server";
import { z } from "zod";
import { addReport, leave } from "@/lib/repo";
import { getUser } from "@/lib/session";

const Body = z.object({
  matchId: z.string().uuid(),
  reason: z.enum(["nudity", "harassment", "underage", "spam", "other"]),
});

export async function POST(req: Request) {
  const u = await getUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await addReport(parsed.data.matchId, u.id, parsed.data.reason))) {
    return NextResponse.json({ error: "no_such_match" }, { status: 404 });
  }
  await leave(u.id);
  return NextResponse.json({ ok: true });
}
