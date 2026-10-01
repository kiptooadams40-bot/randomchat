import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { AGE_COOKIE, AGE_COOKIE_MAX_AGE, signAge, verifyAge } from "./ageCookie";
import { appUrl } from "./env";
import { touchActivity } from "./referrals";
import { createUser, db, normalizeUser, type User } from "./store";

const COOKIE = "rc_uid";
export const REF_COOKIE = "rc_ref";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `Secure` follows the site's real protocol, not the app environment: a Secure
 * cookie is silently dropped by browsers on plain http, which would make every
 * request look like a brand-new visitor.
 */
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

/** Restore the age flag from the signed cookie (the in-memory record may be brand new). */
function hydrateAge(u: User, jar: Jar) {
  if (!u.ageVerified && verifyAge(jar.get(AGE_COOKIE)?.value, u.id)) u.ageVerified = true;
}

/** Called after a successful age check: persists it in a signed cookie. */
export async function rememberAgeVerified(u: User) {
  u.ageVerified = true;
  (await cookies()).set(AGE_COOKIE, signAge(u.id), cookieOptions(AGE_COOKIE_MAX_AGE));
}

/** Route-handler only: resolves the visitor, creating an anonymous user + cookie if needed. */
export async function getUser(): Promise<User> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  const validId = id && UUID.test(id) ? id : undefined;

  let u = validId ? db.users.get(validId) : undefined;
  if (!u && validId) {
    // The cookie is valid but this server instance has never seen it (cold start /
    // another serverless instance). Keep the SAME identity instead of minting a new
    // one, so the signed age cookie (bound to this id) keeps working.
    u = createUser(validId, null);
  }
  if (u) {
    hydrateAge(u, jar);
    touchActivity(u);
    return normalizeUser(u);
  }

  const newId = randomUUID();
  jar.set(COOKIE, newId, cookieOptions());
  // Attribute new users to the referrer whose link brought them here.
  const refCode = jar.get(REF_COOKIE)?.value;
  const referrer = refCode ? db.codes.get(refCode) : undefined;
  return createUser(newId, referrer ?? null);
}

/** Safe in server components (never writes cookies). */
export async function peekUser(): Promise<User | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  const u = id && UUID.test(id) ? db.users.get(id) : undefined;
  if (!u) return null;
  hydrateAge(u, jar);
  return normalizeUser(u);
}
