import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { appUrl } from "./env";
import type { User } from "./entitlements";
import { getProfile, setReferrer, touchActivity } from "./repo";
import { supabaseConfigured } from "./supabase";

export const REF_COOKIE = "rc_ref";

/** `Secure` follows the site's real protocol: browsers drop Secure cookies on plain http. */
export function cookieOptions(maxAge = 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appUrl().startsWith("https://"),
    path: "/",
    maxAge,
  };
}

type Jar = Awaited<ReturnType<typeof cookies>>;

/** Supabase Auth client bound to the request cookies (the anonymous session lives there). */
function authClient(jar: Jar) {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* Server Component: cookies are read-only; middleware refreshes the session. */
        }
      },
    },
  });
}

/** Verified user id from the session JWT (no network call with asymmetric signing keys). */
async function sessionUserId(sb: ReturnType<typeof authClient>): Promise<string | null> {
  const { data } = await sb.auth.getClaims();
  return data?.claims?.sub ?? null;
}

/**
 * Route-handler only. Resolves the visitor from their Supabase session, signing
 * them in anonymously on first visit, and loads their profile from Postgres.
 */
export async function getUser(): Promise<User> {
  // Fail fast with a precise message instead of a confusing network/auth error later.
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  const jar = await cookies();
  const sb = authClient(jar);

  let uid = await sessionUserId(sb);
  let isNew = false;
  if (!uid) {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error || !data.user) {
      throw new Error(`Anonymous sign-in failed (enable it in Supabase Auth settings): ${error?.message ?? "no user"}`);
    }
    uid = data.user.id;
    isNew = true;
  }

  // Attribute brand-new visitors to the referrer whose invite link brought them here.
  if (isNew) {
    const code = jar.get(REF_COOKIE)?.value;
    if (code) await setReferrer(uid, code).catch(() => {});
  }

  const u = await getProfile(uid);
  if (!u) throw new Error(`No profile for user ${uid}: run supabase/app.sql first.`);

  // Only credited referred users still working toward the 10-minute engagement mark
  // need activity tracking, so ordinary requests cost a single database call.
  if (u.referralCredited && !u.engagementCounted) await touchActivity(u.id).catch(() => {});
  return u;
}

/** Safe in Server Components (never signs in or writes cookies). */
export async function peekUser(): Promise<User | null> {
  const jar = await cookies();
  const uid = await sessionUserId(authClient(jar));
  return uid ? getProfile(uid) : null;
}
