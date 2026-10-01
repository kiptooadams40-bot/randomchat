import { NextResponse } from "next/server";
import { isProd } from "@/lib/env";
import { VIP_PASS } from "@/lib/plans";
import { getUser } from "@/lib/session";
import { db, grantVip } from "@/lib/store";

export const dynamic = "force-dynamic";
const SIMULATED_PIN_DELAY_MS = 4000;

/** Simulated customer "enters PIN" a few seconds after the push, then the pass is granted. */
export async function GET(req: Request) {
  if (isProd) return NextResponse.json({ error: "mpesa_not_configured" }, { status: 503 });
  const u = await getUser();
  const stk = db.stk.get(new URL(req.url).searchParams.get("id") ?? "");
  if (!stk || stk.userId !== u.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!stk.done && Date.now() - stk.createdAt > SIMULATED_PIN_DELAY_MS) {
    stk.done = true;
    grantVip(u.id, VIP_PASS.hours, `mpesa_${stk.id}`);
  }
  return NextResponse.json({ status: stk.done ? "paid" : "pending" });
}
