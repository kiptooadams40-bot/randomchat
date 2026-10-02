export const isProd = process.env.APP_ENV === "production";

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function pesapalConfigured() {
  return !!process.env.PESAPAL_CONSUMER_KEY && !!process.env.PESAPAL_CONSUMER_SECRET;
}

/** PesaPal API v3 base URL. Live unless PESAPAL_ENV=sandbox. */
export function pesapalBase() {
  return process.env.PESAPAL_ENV === "sandbox" ? "https://cybqa.pesapal.com/pesapalv3" : "https://pay.pesapal.com/v3";
}

/**
 * Public https origin PesaPal can call back. Prefers NEXT_PUBLIC_APP_URL when it is a real
 * https URL; otherwise derives it from the request (Vercel forwards the public host).
 */
export function publicOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.startsWith("https://") && !configured.includes("localhost")) {
    return configured.replace(/\/+$/, "");
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
