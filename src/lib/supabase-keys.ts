/**
 * Public Supabase settings, safe for browser and server. Accepts the new publishable key
 * (sb_publishable_...) or the legacy anon JWT, so the live project can move to the new
 * keys without a code change. NEXT_PUBLIC_* must be read literally to be inlined.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const placeholder = (v: string | undefined) => !v || v.includes("YOUR-PROJECT") || v.includes("YOUR_");

export const supabasePublicConfigured = () => !placeholder(SUPABASE_URL) && !placeholder(SUPABASE_PUBLIC_KEY);
