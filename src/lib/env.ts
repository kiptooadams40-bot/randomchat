export const isProd = process.env.APP_ENV === "production";

/** Mock providers are refused in production: the app fails closed. */
export function assertMockAllowed(what: string) {
  if (isProd) throw new Error(`${what}: mock provider refused when APP_ENV=production`);
}

export function stripeConfigured() {
  const k = process.env.STRIPE_SECRET_KEY ?? "";
  return k.startsWith("sk_") && !k.includes("REPLACE_ME");
}

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
