import type { Billing, ProductId } from "./plans";

/**
 * Starts a checkout. With `newTab`, the checkout opens in a separate tab so a
 * live (blurred) chat isn't lost; the caller then polls /api/session for the
 * unlock. Returns false if payments are unavailable.
 */
export async function startCheckout(product: ProductId, opts: { newTab?: boolean; billing?: Billing } = {}): Promise<boolean> {
  // Open synchronously (inside the click handler) so popup blockers allow it.
  const tab = opts.newTab ? window.open("", "_blank") : null;
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product, billing: opts.billing ?? "recurring" }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.url) {
    if (tab) tab.location.href = data.url;
    else window.location.href = data.url;
    return true;
  }
  tab?.close();
  return false;
}
