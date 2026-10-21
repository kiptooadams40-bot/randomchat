import "server-only";
import { randomUUID } from "crypto";
import { PesapalError, ensureIpnId, getTransactionStatus, submitOrder } from "./pesapal";
import { PRODUCT_IDS, VIP_PASS, getPlan, quote, type PayMethod, type ProductId } from "./plans";
import { createOrder, getOrder, markOrder, paymentFulfil, setOrderTracking, type Order, type PaymentProvider } from "./repo";

/** Checkout orchestration: create our order, then hand the customer to PesaPal's hosted page. */
export async function createCheckout(args: {
  userId: string;
  email: string | null; // signed-in account email, sent to PesaPal for the receipt
  product: ProductId;
  method: PayMethod;
  origin: string; // public https origin of this deployment
}): Promise<{ redirectUrl: string; merchantReference: string }> {
  const { userId, email, product, method, origin } = args;
  const q = quote(product, method); // server-side price: the client never sends an amount
  const merchantReference = randomUUID();
  const host = new URL(origin).hostname;

  await createOrder({ merchantReference, userId, product, method, currency: q.currency, amount: q.amount, provider: "pesapal", email });
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
      // PesaPal requires an email. Anonymous visitors get a placeholder they can replace on PesaPal's page.
      billing: { email: email ?? `guest-${merchantReference.slice(0, 8)}@${host}` },
    });
    await setOrderTracking(merchantReference, orderTrackingId);
    return { redirectUrl, merchantReference };
  } catch (e) {
    await markOrder(merchantReference, "failed").catch(() => {});
    throw e;
  }
}

export type FulfilOutcome =
  | { status: "completed"; product: ProductId; userId: string | null; already: boolean }
  | { status: "pending" | "failed" | "reversed" | "review"; product: ProductId; userId: string | null }
  | { status: "unknown" };

/**
 * THE single way money turns into access, for every provider (PesaPal now; Stripe and
 * PayPal webhooks will call this too). The caller MUST already have confirmed the payment
 * with the provider's own API. In the database it is checked once more against our stored
 * order (provider, transaction id, amount, currency) and granted exactly once.
 */
export async function fulfilVerifiedPayment(p: {
  order: Order;
  provider: PaymentProvider;
  txnId: string;
  amount: number;
  currency: string;
}): Promise<FulfilOutcome> {
  const { order } = p;
  const base = { product: order.product, userId: order.user_id };
  const r = await paymentFulfil({
    merchantReference: order.merchant_reference,
    provider: p.provider,
    txnId: p.txnId,
    amount: p.amount,
    currency: p.currency,
    days: getPlan(order.product)?.days ?? 0,
    hours: VIP_PASS.hours,
  });
  if (!r.ok) {
    // Provider says paid but it doesn't match our order: the customer WAS charged, so flag for review.
    console.error(`[payments] PAID but rejected (${r.reason}), needs manual review:`, order.merchant_reference, p.txnId);
    return { status: "review", ...base };
  }
  return { status: "completed", ...base, already: r.already };
}

/**
 * Used by BOTH the PesaPal IPN and the return page's confirm check. Nothing the caller sends
 * is trusted: it only says which order to look at. We ask PesaPal (GetTransactionStatus) and
 * grant only if it reports COMPLETED and its merchant reference, tracking id, amount and
 * currency all match the order we stored.
 */
export async function confirmPesapalOrder(by: { merchantReference?: string | null; trackingId?: string | null }): Promise<FulfilOutcome> {
  const order = await getOrder(by);
  if (!order) return { status: "unknown" };
  const base = { product: order.product, userId: order.user_id };
  if (order.status === "completed") return { status: "completed", ...base, already: true };
  if (order.provider !== "pesapal") return { status: "pending", ...base };

  // The tracking id we stored at checkout is authoritative; a different one in the request is ignored.
  const trackingId = order.order_tracking_id ?? by.trackingId ?? null;
  if (!trackingId) return { status: "pending", ...base }; // customer hasn't reached PesaPal yet
  if (by.trackingId && order.order_tracking_id && by.trackingId !== order.order_tracking_id) {
    console.error("[payments] tracking id in request does not match the order", order.merchant_reference);
  }

  const tx = await getTransactionStatus(trackingId);
  if (tx.merchantReference.toLowerCase() !== order.merchant_reference.toLowerCase()) {
    console.error("[payments] tracking id does not belong to order", order.merchant_reference);
    return { status: "pending", ...base };
  }

  if (tx.statusCode === 1) {
    return fulfilVerifiedPayment({ order, provider: "pesapal", txnId: trackingId, amount: tx.amount, currency: tx.currency });
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
