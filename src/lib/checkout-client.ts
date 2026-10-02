import type { PayMethod, ProductId } from "./plans";

/**
 * Starts a PesaPal checkout: asks the server to create the order, then sends the
 * browser straight to PesaPal's hosted page (M-Pesa and card entry happen there).
 * Resolves to an error message, or never resolves on success (the page navigates away).
 */
export async function startCheckout(product: ProductId, method: PayMethod): Promise<string | null> {
  try {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, method }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && typeof data?.redirect_url === "string") {
      window.location.href = data.redirect_url;
      return new Promise<never>(() => {}); // keep the button in its "Redirecting…" state while navigating
    }
    return data?.message ?? "We couldn't start the payment. Please try again.";
  } catch {
    return "Network error. Check your connection and try again.";
  }
}
