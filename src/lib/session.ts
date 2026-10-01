import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { isProd } from "./env";
import { touchActivity } from "./referrals";
import { createUser, db, normalizeUser, type User } from "./store";

const COOKIE = "rc_uid";
export const REF_COOKIE = "rc_ref";

/** Route-handler only: creates an anonymous user + cookie if needed. */
export async function getUser(): Promise<User> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  const existing = id ? db.users.get(id) : undefined;
  if (existing) {
    touchActivity(existing);
    return normalizeUser(existing);
  }
  const newId = randomUUID();
  jar.set(COOKIE, newId, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  // Attribute new users to the referrer whose link brought them here.
  const refCode = jar.get(REF_COOKIE)?.value;
  const referrer = refCode ? db.codes.get(refCode) : undefined;
  return createUser(newId, referrer ?? null);
}

/** Safe in server components (never writes cookies). */
export async function peekUser(): Promise<User | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  const u = id ? db.users.get(id) : undefined;
  return u ? normalizeUser(u) : null;
}
