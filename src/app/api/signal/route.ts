import { NextResponse } from "next/server";
import { z } from "zod";
import { drainSignals, pushSignal } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  matchId: z.string().uuid(),
  type: z.enum(["offer", "answer", "ice"]),
  payload: z.unknown(),
});

export async function POST(req: Request) {
  const u = await getUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { matchId, type, payload } = parsed.data;
  if (JSON.stringify(payload ?? null).length > 20_000) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const ok = await pushSignal(matchId, u.id, type, payload);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ended: true }, { status: 410 });
}

export async function GET(req: Request) {
  const u = await getUser();
  const matchId = new URL(req.url).searchParams.get("matchId") ?? "";
  if (!z.string().uuid().safeParse(matchId).success) return NextResponse.json({ ended: true });
  return NextResponse.json(await drainSignals(matchId, u.id));
}
