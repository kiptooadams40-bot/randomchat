import { NextResponse } from "next/server";
import { fulfilByReference } from "@/lib/payments";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING = /^[\w-]{6,100}$/;

/**
 * PesaPal IPN (registered as a GET callback; POST is accepted too).
 * This endpoint is public and unauthenticated, so NOTHING in the request is trusted:
 * the parameters only tell us which order to re-check. fulfilByReference asks PesaPal
 * for the real status and verifies it against our own order before granting anything.
 */
async function handle(req: Request) {
  const url = new URL(req.url);
  let trackingId = url.searchParams.get("OrderTrackingId");
  let reference = url.searchParams.get("OrderMerchantReference");
  let type = url.searchParams.get("OrderNotificationType") ?? "IPNCHANGE";

  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    trackingId ??= body?.OrderTrackingId ?? null;
    reference ??= body?.OrderMerchantReference ?? null;
    type = body?.OrderNotificationType ?? type;
  }

  if (trackingId && !TRACKING.test(trackingId)) trackingId = null;
  if (reference && !UUID.test(reference)) reference = null;
  if (!trackingId && !reference) {
    return NextResponse.json({ status: 400, message: "OrderTrackingId or OrderMerchantReference required" }, { status: 400 });
  }

  try {
    const outcome = await fulfilByReference({ merchantReference: reference, trackingId });
    console.log(`[api/billing/ipn] ${type} tracking=${trackingId ?? "-"} ref=${reference ?? "-"} -> ${outcome.status}`);
  } catch (e) {
    // Transient (PesaPal/DB down): a 5xx makes PesaPal retry the notification.
    console.error("[api/billing/ipn] verification failed:", e);
    return NextResponse.json({ status: 500 }, { status: 500 });
  }

  // Acknowledge in the shape PesaPal expects. Pending / failed / unknown orders are still
  // acknowledged: PesaPal sends a fresh IPN when their status changes.
  return NextResponse.json({
    orderNotificationType: type,
    orderTrackingId: trackingId,
    orderMerchantReference: reference,
    status: 200,
  });
}

export const GET = handle;
export const POST = handle;
