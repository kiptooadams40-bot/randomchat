import "server-only";
import { createHash } from "crypto";

/**
 * Sign-in limits. Per-email limits are the strict ones; per-IP limits are deliberately loose
 * because many real people share one IP on mobile data and campus Wi-Fi.
 */
export const LIMITS = {
  codeEmailGap: { max: 1, windowS: 60 }, // one code per email per minute
  codeEmailHour: { max: 5, windowS: 3600 }, // five codes per email per hour
  codeIpHour: { max: 60, windowS: 3600 },
  wrongEmail: { max: 5, windowS: 15 * 60 }, // five wrong codes per email, then a 15-minute lock
  wrongIpHour: { max: 200, windowS: 3600 },
} as const;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Rate-limit keys never contain the raw email or IP. */
export const hashKey = (kind: string, value: string) =>
  `${kind}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
