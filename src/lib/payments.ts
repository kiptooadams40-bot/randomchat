import "server-only";
import { randomUUID } from "crypto";
import { PesapalError, ensureIpnId, getTransactionStatus, submitOrder } from "./pesapal";
import { PRODUCT_IDS, VIP_PASS, getPlan, quote, type PayMethod, type ProductId } from "./plans";
import { createOrder, fulfilOrder, getOrder, markOrder, setOrderTracking } from "./repo";

/** Checkout orchestration: create our order, then hand the customer to PesaPal's hosted page. */
export async function createCheckout(args: {
  userId: string;
  product: ProductId;
  method: PayMethod;
  origin: string; // public https origin of this deployment
}): Promise<{ redirectUrl: string; merchantReference: string }> {
  const { userId, product, method, origin } = args;
  const q = quote(product, method); // server-side price: the client never sends an amount
  const merchantReference = randomUUID();
  const host = new URL(origin).hostname;

  await createOrder({ merchantReference, userId, product, method, currency: q.currency, amount: q.amount });
  try {
    const notificationId = await ensureIpnId(`${origin}/api/billing/ipn`);
    const { orderTrackingId, redirectUrl } = await submitOrder({
      merchantReference,
      currency: q.currency,
      amount: q.amount,
      description: q.description,
      callbackUrl: `${origin}/checkout/success?ref=${merchantReference}`,
      cancellationUrl: `${origin}${product === VIP_PASS.id ? "/chat" : "/pricing"}`,
      notificationId,
      // Anonymous users have no email on file; PesaPal requires one. The hosted page lets the
      // customer enter their real details; this is only the placeholder it starts from.
      billing: { email: `guest-${merchantReference.slice(0, 8)}@${host}` },
    });
    await setOrderTracking(merchantReference, orderTrackingId);
    return { redirectUrl, merchantReference };
  } catch (e) {
    await markOrder(merchantReference, "failed").catch(() => {});
    throw e;
  }
}

export type FulfilOutcome =
  | { status: "completed"; product: ProductId; userId: string; already: boolean }
  | { status: "pending" | "failed" | "reversed" | "review"; product: ProductId; userId: string }
  | { status: "unknown" };

/**
 * Called by BOTH the IPN webhook and the post-payment redirect page. It never trusts
 * what the caller says: it asks PesaPal for the transaction status by tracking id,
 * checks that status belongs to OUR order (merchant reference, amount, currency),
 * and only then grants the entitlement, exactly once.
 */
export async function fulfilByReference(by: { merchantReference?: string | null; trackingId?: string | null }): Promise<FulfilOutcome> {
  const order = await getOrder(by);
  if (!order) return { status: "unknown" };
  const base = { product: order.product, userId: order.user_id };
  if (order.status === "completed") return { status: "completed", ...base, already: true };

  const trackingId = order.order_tracking_id ?? by.trackingId ?? null;
  if (!trackingId) return { status: "pending", ...base }; // customer hasn't reached PesaPal yet

  const tx = await getTransactionStatus(trackingId);
  // Case-insensitive: PesaPal may echo our UUID in a different case.
  if (tx.merchantReference.toLowerCase() !== order.merchant_reference.toLowerCase()) {
    // That tracking id isn't for this order (spoofed or mixed up): never fulfil.
    console.error("[payments] tracking id does not belong to order", order.merchant_reference);
    return { status: "pending", ...base };
  }

  if (tx.statusCode === 1) {
    const plan = getPlan(order.product);
    const r = await fulfilOrder({
      merchantReference: order.merchant_reference,
      trackingId,
      amount: tx.amount,
      currency: tx.currency,
      days: plan?.days ?? 0,
      hours: VIP_PASS.hours,
    });
    if (!r.ok) {
      // PesaPal says it's paid but it doesn't match our order (amount/currency/tracking id).
      // The customer WAS charged, so don't call this a failure: flag it for manual review.
      console.error("[payments] PAID but rejected, needs manual review:", r.reason, order.merchant_reference, trackingId);
      return { status: "review", ...base };
    }
    return { status: "completed", ...base, already: r.already };
  }
  if (tx.statusCode === 2) {
    await markOrder(order.merchant_reference, "failed");
    return { status: "failed", ...base };
  }
  if (tx.statusCode === 3) {
    await markOrder(order.merchant_reference, "reversed");
    return { status: "reversed", ...base };
  }
  return { status: "pending", ...base };
}

export function isProductId(v: unknown): v is ProductId {
  return typeof v === "string" && (PRODUCT_IDS as readonly string[]).includes(v);
}

export { PesapalError };
