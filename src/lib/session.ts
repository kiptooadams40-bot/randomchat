import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { appUrl } from "./env";
import type { User } from "./entitlements";
import { getProfile, loadUser, setReferrer, touchActivity } from "./repo";
import { supabaseConfigured } from "./supabase";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "./supabase-keys";

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

/** Supabase Auth client bound to the request cookies (the session lives there). */
export function authClient(jar: Jar) {
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
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

export type Identity = { uid: string; email: string | null; anonymous: boolean; sessionId: string | null };

/** Verified identity from the session JWT (no network call with asymmetric signing keys). */
export async function sessionIdentity(sb: ReturnType<typeof authClient>): Promise<Identity | null> {
  const { data } = await sb.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  return {
    uid: c.sub,
    email: typeof c.email === "string" && c.email ? c.email : null,
    anonymous: c.is_anonymous === true || !c.email,
    sessionId: typeof c.session_id === "string" ? c.session_id : null,
  };
}

/** session_id claim of a token we just received (it was minted by Supabase moments ago). */
function sessionIdOf(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

export type SessionUser = User & { email: string | null; anonymous: boolean; sessionId: string | null; banned: boolean };

async function signInAnon(sb: ReturnType<typeof authClient>, jar: Jar): Promise<Identity> {
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user || !data.session) {
    throw new Error(`Anonymous sign-in failed (enable it in Supabase Auth settings): ${error?.message ?? "no user"}`);
  }
  const uid = data.user.id;
  // Attribute brand-new visitors to the referrer whose invite link brought them here.
  const code = jar.get(REF_COOKIE)?.value;
  if (code) await setReferrer(uid, code).catch(() => {});
  return { uid, email: null, anonymous: true, sessionId: sessionIdOf(data.session.access_token) };
}

/**
 * Route-handler only. Resolves the visitor from their Supabase session, signing them in
 * anonymously on first visit (no sign-up needed to chat), and loads their profile.
 * A session revoked elsewhere ("Sign out of all devices") is replaced by a fresh
 * anonymous one at once instead of lingering until the access token expires.
 */
export async function getUser(): Promise<SessionUser> {
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.",
    );
  }
  const jar = await cookies();
  const sb = authClient(jar);

  let id = (await sessionIdentity(sb)) ?? (await signInAnon(sb, jar));
  let loaded = await loadUser(id.uid, id.sessionId);
  if (loaded && !loaded.sessionOk) {
    await sb.auth.signOut({ scope: "local" }).catch(() => {});
    id = await signInAnon(sb, jar);
    loaded = await loadUser(id.uid, id.sessionId);
  }
  if (!loaded) throw new Error(`No profile for user ${id.uid}: run supabase/app.sql first.`);

  const u = loaded.user;
  // Only credited referred users still working toward the engagement mark need tracking.
  if (u.referralCredited && !u.engagementCounted) await touchActivity(u.id).catch(() => {});
  return { ...u, email: id.email, anonymous: id.anonymous, sessionId: id.sessionId, banned: loaded.banned };
}

/** Safe in Server Components (never signs in or writes cookies). */
export async function peekUser(): Promise<User | null> {
  const jar = await cookies();
  const id = await sessionIdentity(authClient(jar));
  return id ? getProfile(id.uid) : null;
}

/** First hop of x-forwarded-for (Vercel sets it). Only used as a loose rate-limit key. */
export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
