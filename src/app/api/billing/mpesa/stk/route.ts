import { NextResponse } from "next/server";
import { z } from "zod";
import { isProd } from "@/lib/env";
import { createMpesa } from "@/lib/repo";
import { getUser } from "@/lib/session";

// Kenyan mobile: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, +2547XXXXXXXX
const Body = z.object({ phone: z.string().regex(/^(?:\+?254|0)[17]\d{8}$/) });

/**
 * SIMULATED M-Pesa STK push. No money moves and no Safaricom call is made.
 * Refused in production until a real Daraja/Pesapal integration replaces it.
 */
export async function POST(req: Request) {
  if (isProd) return NextResponse.json({ error: "mpesa_not_configured" }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_phone" }, { status: 400 });
  const u = await getUser();
  return NextResponse.json({ id: await createMpesa(u.id), simulated: true });
}
