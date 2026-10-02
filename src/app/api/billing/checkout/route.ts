import { NextResponse } from "next/server";
import { z } from "zod";
import { publicOrigin } from "@/lib/env";
import { PesapalError, createCheckout } from "@/lib/payments";
import { PAY_METHODS, PRODUCT_IDS } from "@/lib/plans";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// The browser sends only WHICH plan and HOW to pay. Amounts/currencies are decided server-side.
const Body = z.object({
  product: z.enum(PRODUCT_IDS),
  method: z.enum(PAY_METHODS),
});

/** Creates the PesaPal order and returns { redirect_url } for the browser to navigate to. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", message: "Choose a plan and a payment method." }, { status: 400 });
  }
  try {
    const u = await getUser();
    const { redirectUrl, merchantReference } = await createCheckout({
      userId: u.id,
      product: parsed.data.product,
      method: parsed.data.method,
      origin: publicOrigin(req),
    });
    return NextResponse.json({ redirect_url: redirectUrl, merchant_reference: merchantReference });
  } catch (e) {
    console.error("[api/billing/checkout] failed:", e);
    const notConfigured = e instanceof PesapalError && e.status === 503;
    return NextResponse.json(
      {
        error: notConfigured ? "payments_not_configured" : "checkout_failed",
        message: notConfigured
          ? "Payments aren't available right now. Please try again later."
          : "We couldn't start the payment. Please try again in a moment.",
      },
      { status: notConfigured ? 503 : 502 },
    );
  }
}
