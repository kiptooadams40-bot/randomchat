import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const placeholder = (v: string | undefined) => !v || v.includes("YOUR-PROJECT") || v.includes("YOUR_");

export function supabaseConfigured() {
  return (
    !placeholder(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    !placeholder(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    !placeholder(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

let admin: SupabaseClient | null = null;

/**
 * Service-role client: bypasses RLS and may execute the server-only rc_* SQL
 * functions. Never import this from client code; never expose the key.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return (admin ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}
