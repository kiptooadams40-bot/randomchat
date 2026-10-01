import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { drainSignals, pushSignal } from "@/lib/store";

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
  const ok = pushSignal(matchId, u.id, { type, payload });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ended: true }, { status: 410 });
}

export async function GET(req: Request) {
  const u = await getUser();
  const matchId = new URL(req.url).searchParams.get("matchId") ?? "";
  const messages = drainSignals(matchId, u.id);
  if (messages === null) return NextResponse.json({ ended: true });
  return NextResponse.json({ messages });
}
