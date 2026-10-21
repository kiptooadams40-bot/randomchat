import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, supabasePublicConfigured } from "./supabase-keys";

/**
 * Server key: the new secret key (sb_secret_..., not a JWT) or the legacy service_role JWT.
 * supabase-js sends it as the apikey header, which both kinds support.
 */
const secretKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function supabaseConfigured() {
  const k = secretKey();
  return supabasePublicConfigured() && !!k && !k.includes("YOUR_");
}

let admin: SupabaseClient | null = null;

/**
 * Service-level client: bypasses RLS and may execute the server-only rc_* SQL
 * functions and the Auth admin API. Never import this from client code.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY) and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return (admin ??= createClient(SUPABASE_URL, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}
