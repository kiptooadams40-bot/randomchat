import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { isProd } from "./env";

/**
 * Stateless proof of age verification: a signed, httpOnly cookie bound to the
 * user's id. It survives serverless cold starts / instance hops, unlike the
 * in-memory user record. It is the source of truth for "has this browser
 * passed the age gate?"; the in-memory flag is just a cache of it.
 */
export const AGE_COOKIE = "rc_age";
export const AGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // Fail loudly in production rather than silently re-prompting forever (or
  // signing with a guessable key).
  if (isProd || process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (16+ chars) must be set to persist age verification.");
  }
  return "dev-only-session-secret-change-me";
}

const mac = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function signAge(uid: string): string {
  const body = Buffer.from(JSON.stringify({ uid, iat: Date.now() })).toString("base64url");
  return `${body}.${mac(body)}`;
}

/** True only if the token is correctly signed, for this uid, and not expired. */
export function verifyAge(token: string | undefined, uid: string): boolean {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(mac(body));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const { uid: tokenUid, iat } = JSON.parse(Buffer.from(body, "base64url").toString());
    return tokenUid === uid && typeof iat === "number" && Date.now() - iat < AGE_COOKIE_MAX_AGE * 1000;
  } catch {
    return false;
  }
}
