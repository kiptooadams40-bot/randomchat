import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITS, hashKey, normalizeEmail } from "@/lib/auth-limits";
import { mergeUsers, rateHit, rateReset } from "@/lib/repo";
import { authClient, clientIp, sessionIdentity } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().trim().regex(/^\d{6}$/),
});

/**
 * Checks the 6-digit code and signs this browser into the account. If the browser was an
 * anonymous visitor, everything it had (Premium time, matches used, referrals, orders)
 * is merged into the account, then the anonymous identity is deleted.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_code", message: "Enter the 6-digit code from the email." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  const wrongKey = hashKey("wrong-email", email);
  const wrongIpKey = hashKey("wrong-ip", clientIp(req));

  // Locked out after too many wrong codes (checked without counting this attempt).
  const emailOk = await rateHit(wrongKey, LIMITS.wrongEmail.max - 1, LIMITS.wrongEmail.windowS, 0);
  const ipOk = await rateHit(wrongIpKey, LIMITS.wrongIpHour.max - 1, LIMITS.wrongIpHour.windowS, 0);
  if (!emailOk || !ipOk) {
    return NextResponse.json({ error: "locked", message: "Too many wrong codes. Wait 15 minutes, then request a new code." }, { status: 429 });
  }

  const sb = authClient(await cookies());
  const before = await sessionIdentity(sb);
  const { data, error } = await sb.auth.verifyOtp({ email, token: parsed.data.code, type: "email" });
  if (error || !data.user) {
    await rateHit(wrongKey, LIMITS.wrongEmail.max, LIMITS.wrongEmail.windowS);
    await rateHit(wrongIpKey, LIMITS.wrongIpHour.max, LIMITS.wrongIpHour.windowS);
    return NextResponse.json({ error: "wrong_code", message: "That code is wrong or has expired." }, { status: 400 });
  }
  await rateReset(wrongKey).catch(() => {});

  const into = data.user.id;
  let merged = false;
  if (before?.anonymous && before.uid !== into) {
    try {
      merged = (await mergeUsers(before.uid, into)).merged;
      const { error: delErr } = await supabaseAdmin().auth.admin.deleteUser(before.uid);
      if (delErr) console.error("[api/auth/verify] could not delete merged anonymous user:", before.uid, delErr.message);
    } catch (e) {
      // Signed in either way; the anonymous identity is untouched, so nothing is lost.
      console.error("[api/auth/verify] merge failed:", before.uid, "->", into, e);
    }
  }
  return NextResponse.json({ ok: true, merged });
}
