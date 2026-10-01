import { NextResponse } from "next/server";
import { stripeConfigured } from "@/lib/env";
import { VIP_PASS, getPlan } from "@/lib/plans";
import { activatePlan, db, grantVip } from "@/lib/store";
import { getStripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!stripeConfigured() || !secret || secret.includes("REPLACE_ME")) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "no_signature" }, { status: 400 });
  const raw = await req.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const userId = s.metadata?.userId;
    if (s.payment_status === "paid" && userId) {
      const u = db.users.get(userId);
      if (u && typeof s.customer === "string") u.stripeCustomerId = s.customer;
      if (s.metadata?.product === VIP_PASS.id) {
        grantVip(userId, VIP_PASS.hours, s.id);
      } else {
        const plan = getPlan(s.metadata?.product);
        if (plan) {
          const billing = s.metadata?.billing === "once" ? "once" : "recurring";
          activatePlan(userId, plan.id, typeof s.invoice === "string" ? s.invoice : s.id, billing);
        }
      }
    }
  }

  // Renewals: each paid invoice extends access by one billing period.
  // Cancelled subscriptions simply stop producing invoices and expire.
  if (event.type === "invoice.paid") {
    const inv = event.data.object as unknown as {
      id: string;
      subscription?: string | null;
      parent?: { subscription_details?: { subscription?: string } };
    };
    const subId = inv.parent?.subscription_details?.subscription ?? inv.subscription;
    if (subId) {
      const sub = await getStripe().subscriptions.retrieve(subId);
      const plan = getPlan(sub.metadata?.product);
      if (plan && sub.metadata?.userId) activatePlan(sub.metadata.userId, plan.id, inv.id);
    }
  }
  return NextResponse.json({ received: true });
}
