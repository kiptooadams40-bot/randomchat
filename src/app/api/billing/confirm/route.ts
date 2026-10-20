import { NextResponse } from "next/server";
import { confirmPesapalOrder } from "@/lib/payments";
import { getOrder, rateHit } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Polled by /checkout/success after PesaPal sends the customer back. The browser is not
 * trusted: this asks PesaPal for the real status and grants through the same exactly-once
 * path as the IPN (confirmPesapalOrder -> fulfilVerifiedPayment). Only the order's owner
 * may check it, and checks are rate-limited.
 */
export async function GET(req: Request) {
  try {
    const ref = new URL(req.url).searchParams.get("ref") ?? "";
    if (!UUID.test(ref)) return NextResponse.json({ status: "unknown" }, { status: 404 });
    const u = await getUser();
    if (!(await rateHit(`confirm:${u.id}`, 30, 60))) {
      return NextResponse.json({ status: "checking", message: "Too many checks, slowing down." }, { status: 429 });
    }
    const order = await getOrder({ merchantReference: ref });
    if (!order || order.user_id !== u.id) return NextResponse.json({ status: "unknown" }, { status: 404 });

    const outcome = await confirmPesapalOrder({ merchantReference: ref });
    return NextResponse.json({ status: outcome.status, product: order.product, signedIn: !u.anonymous });
  } catch (e) {
    console.error("[api/billing/confirm] failed:", e);
    return NextResponse.json({ status: "error", message: "We couldn't check the payment yet. Please try again." }, { status: 502 });
  }
}
