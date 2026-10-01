import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isProd } from "@/lib/env";
import { VIP_PASS, getPlan } from "@/lib/plans";
import { getUser } from "@/lib/session";
import { activatePlan, grantVip } from "@/lib/store";

const Body = z.object({
  product: z.enum(["weekly", "fortnightly", "monthly", "vip24"]),
  billing: z.enum(["recurring", "once"]).default("recurring"),
});

export async function POST(req: Request) {
  if (isProd) return NextResponse.json({ error: "refused" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_product" }, { status: 400 });
  const u = await getUser();
  const ref = `mock_${randomUUID()}`;
  if (parsed.data.product === VIP_PASS.id) grantVip(u.id, VIP_PASS.hours, ref);
  else activatePlan(u.id, getPlan(parsed.data.product)!.id, ref, parsed.data.billing);
  return NextResponse.json({ ok: true });
}
