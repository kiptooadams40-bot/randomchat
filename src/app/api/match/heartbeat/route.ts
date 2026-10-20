import { NextResponse } from "next/server";
import { z } from "zod";
import { matchHeartbeat } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Sent every few seconds during a chat: keeps it alive and reports if the partner left. */
export async function POST(req: Request) {
  const u = await getUser();
  const matchId = (await req.json().catch(() => null))?.matchId;
  if (!z.string().uuid().safeParse(matchId).success) return NextResponse.json({ ended: true });
  return NextResponse.json(await matchHeartbeat(matchId, u.id));
}
