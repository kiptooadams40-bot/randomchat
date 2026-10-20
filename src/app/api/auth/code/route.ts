import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITS, hashKey, normalizeEmail } from "@/lib/auth-limits";
import { rateHit } from "@/lib/repo";
import { authClient, clientIp } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().trim().email().max(254) });

/** Emails a 6-digit sign-in code (not a magic link: a link would open in a different browser). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_email", message: "Enter a valid email address." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);

  const ipOk = await rateHit(hashKey("code-ip", clientIp(req)), LIMITS.codeIpHour.max, LIMITS.codeIpHour.windowS);
  const gapOk = await rateHit(hashKey("code-gap", email), LIMITS.codeEmailGap.max, LIMITS.codeEmailGap.windowS);
  if (!gapOk) {
    return NextResponse.json({ error: "too_soon", message: "We just sent a code. Wait a minute before asking for another." }, { status: 429 });
  }
  const hourOk = await rateHit(hashKey("code-hour", email), LIMITS.codeEmailHour.max, LIMITS.codeEmailHour.windowS);
  if (!hourOk || !ipOk) {
    return NextResponse.json({ error: "rate_limited", message: "Too many codes requested. Try again later." }, { status: 429 });
  }

  const sb = authClient(await cookies());
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    console.error("[api/auth/code] signInWithOtp failed:", error.status, error.message);
    const limited = error.status === 429 || /rate limit/i.test(error.message);
    return NextResponse.json(
      {
        error: limited ? "rate_limited" : "send_failed",
        message: limited ? "Too many codes requested. Try again in a few minutes." : "We couldn't send the code. Please try again.",
      },
      { status: limited ? 429 : 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
