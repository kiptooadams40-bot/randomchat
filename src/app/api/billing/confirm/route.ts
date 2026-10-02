import { NextResponse } from "next/server";
import { fulfilByReference } from "@/lib/payments";
import { getOrder } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Polled by /checkout/success after PesaPal redirects the customer back. Verifies the
 * payment with PesaPal right now (so Premium/VIP shows up without waiting for the IPN).
 * Only the user who created the order can read its status.
 */
export async function GET(req: Request) {
  try {
    const ref = new URL(req.url).searchParams.get("ref") ?? "";
    if (!UUID.test(ref)) return NextResponse.json({ status: "unknown" }, { status: 404 });
    const u = await getUser();
    const order = await getOrder({ merchantReference: ref });
    if (!order || order.user_id !== u.id) return NextResponse.json({ status: "unknown" }, { status: 404 });

    const outcome = await fulfilByReference({ merchantReference: ref });
    return NextResponse.json({ status: outcome.status, product: order.product });
  } catch (e) {
    console.error("[api/billing/confirm] failed:", e);
    return NextResponse.json({ status: "error", message: "We couldn't check the payment yet. Please try again." }, { status: 502 });
  }
}
