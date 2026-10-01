import { NextResponse } from "next/server";
import { stripeConfigured } from "@/lib/env";
import { VIP_PASS, getPlan } from "@/lib/plans";
import { getUser } from "@/lib/session";
import { activatePlan, grantVip } from "@/lib/store";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** Confirms a Stripe Checkout session on redirect (works without the webhook in local dev). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session_id");
  if (!id || !stripeConfigured()) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const u = await getUser();
  const s = await getStripe().checkout.sessions.retrieve(id);
  if (s.payment_status !== "paid" || s.metadata?.userId !== u.id) {
    return NextResponse.json({ ok: false }, { status: 402 });
  }
  if (typeof s.customer === "string") u.stripeCustomerId = s.customer;
  const product = s.metadata?.product;
  if (product === VIP_PASS.id) {
    grantVip(u.id, VIP_PASS.hours, s.id);
  } else {
    const plan = getPlan(product);
    if (!plan) return NextResponse.json({ ok: false }, { status: 402 });
    // Same ref the webhook uses (the first invoice), so the two never double-activate.
    activatePlan(u.id, plan.id, typeof s.invoice === "string" ? s.invoice : s.id, s.metadata?.billing === "once" ? "once" : "recurring");
  }
  return NextResponse.json({ ok: true, product });
}
