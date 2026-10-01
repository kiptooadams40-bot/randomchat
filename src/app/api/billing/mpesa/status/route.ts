import { NextResponse } from "next/server";
import { z } from "zod";
import { isProd } from "@/lib/env";
import { mpesaStatus } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";
const SIMULATED_PIN_DELAY_MS = 4000;

/** Simulated customer "enters PIN" a few seconds after the push, then the pass is granted. */
export async function GET(req: Request) {
  if (isProd) return NextResponse.json({ error: "mpesa_not_configured" }, { status: 503 });
  const u = await getUser();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = await mpesaStatus(id, u.id, SIMULATED_PIN_DELAY_MS);
  if (!status) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ status });
}
