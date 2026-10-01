import { NextResponse } from "next/server";
import { appUrl, stripeConfigured } from "@/lib/env";
import { getStripeCustomer } from "@/lib/repo";
import { getUser } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

/** Stripe Customer Portal: where subscribers cancel or update their card. */
export async function POST() {
  const u = await getUser();
  const customer = stripeConfigured() ? await getStripeCustomer(u.id) : null;
  if (!customer) return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  const s = await getStripe().billingPortal.sessions.create({
    customer,
    return_url: `${appUrl()}/account`,
  });
  return NextResponse.json({ url: s.url });
}
