import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isProd } from "@/lib/env";
import { VIP_PASS, getPlan } from "@/lib/plans";
import { activatePlan, grantVipPass } from "@/lib/repo";
import { getUser } from "@/lib/session";

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
  if (parsed.data.product === VIP_PASS.id) await grantVipPass(u.id, ref, "mock");
  else await activatePlan(u.id, getPlan(parsed.data.product)!.id, ref, parsed.data.billing, "mock");
  return NextResponse.json({ ok: true });
}
