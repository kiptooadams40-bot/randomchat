import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, supabasePublicConfigured } from "./supabase-keys";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (publishable/anon key only; never the secret key). It reads the
 * session cookies the server set, so it acts as the same visitor. Used only for Realtime,
 * and only after the visitor taps Start.
 */
export function supabaseBrowser(): SupabaseClient | null {
  if (!supabasePublicConfigured()) return null;
  return (client ??= createBrowserClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY));
}
