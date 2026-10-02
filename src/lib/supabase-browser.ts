import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (ANON key only; never the service role). It reads the anonymous
 * session cookies the server already set, so it acts as the same visitor. It is used solely
 * for Realtime: RLS lets that user receive changes to their own profile row and nothing else.
 */
export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || url.includes("YOUR-PROJECT")) return null;
  return (client ??= createBrowserClient(url, anon));
}
