import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl, isProd, stripeConfigured } from "@/lib/env";
import { VIP_PASS, getPlan } from "@/lib/plans";
import { getUser } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

const Body = z.object({
  product: z.enum(["weekly", "fortnightly", "monthly", "vip24"]),
  billing: z.enum(["recurring", "once"]).default("recurring"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_product" }, { status: 400 });
  const { product, billing } = parsed.data;
  const u = await getUser();

  if (!stripeConfigured()) {
    // Mock gateway: dev only.
    if (isProd) return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
    return NextResponse.json({ url: `${appUrl()}/checkout/mock?product=${product}&billing=${billing}` });
  }

  const success_url = `${appUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}&product=${product}&billing=${billing}`;

  if (product === VIP_PASS.id) {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "usd", unit_amount: VIP_PASS.priceCents, product_data: { name: VIP_PASS.name } },
        },
      ],
      metadata: { userId: u.id, product },
      success_url,
      cancel_url: `${appUrl()}/chat`,
    });
    return NextResponse.json({ url: session.url });
  }

  const plan = getPlan(product)!;
  const metadata = { userId: u.id, product, billing };

  if (billing === "once") {
    // One-time payment: a single charge for this plan's duration. No subscription is created,
    // so nothing can renew.
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: plan.priceCents,
            product_data: { name: `RandomChat Premium – ${plan.name} (one-time, ${plan.days} days)` },
          },
        },
      ],
      metadata,
      success_url,
      cancel_url: `${appUrl()}/pricing`,
    });
    return NextResponse.json({ url: session.url });
  }

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: plan.priceCents,
          recurring: { interval: plan.interval.unit, interval_count: plan.interval.count },
          product_data: { name: `RandomChat Premium – ${plan.name} (recurring)` },
        },
      },
    ],
    metadata,
    subscription_data: { metadata },
    success_url,
    cancel_url: `${appUrl()}/pricing`,
  });
  return NextResponse.json({ url: session.url });
}
