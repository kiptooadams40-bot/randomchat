import { NextResponse } from "next/server";
import { freeMatchesLeft, isPremium, isVip } from "@/lib/entitlements";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Turn a thrown error into a safe, actionable JSON error (never an empty body). */
function classify(e: unknown): { status: number; code: string; hint: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not configured|url and api key are required|invalid api key|invalid url/i.test(msg)) {
    return {
      status: 500,
      code: "supabase_not_configured",
      hint: "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, then redeploy.",
    };
  }
  if (/fetch failed|enotfound|econnrefused|etimedout|network/i.test(msg)) {
    return {
      status: 500,
      code: "supabase_unreachable",
      hint: "Could not reach Supabase. Check that NEXT_PUBLIC_SUPABASE_URL is correct and the project isn't paused.",
    };
  }
  if (/anonymous sign-in|anonymous sign-ins are disabled|captcha/i.test(msg)) {
    return {
      status: 500,
      code: "anonymous_signin_failed",
      hint: "Enable anonymous sign-ins in Supabase Auth (and disable CAPTCHA, or pass a captcha token).",
    };
  }
  if (/could not find the function|rc_get_profile|no profile for user|relation .* does not exist|schema cache/i.test(msg)) {
    return {
      status: 500,
      code: "database_not_migrated",
      hint: "Run supabase/app.sql in the Supabase SQL Editor (it is idempotent and reconciles your existing tables).",
    };
  }
  return { status: 500, code: "internal_error", hint: "Unexpected server error. Check the server logs." };
}

export async function GET() {
  try {
    const u = await getUser();
    return NextResponse.json(
      {
        ageVerified: u.ageVerified,
        gender: u.gender,
        country: u.country,
        premium: isPremium(u),
        plan: u.plan,
        planExpiresAt: u.planExpiresAt,
        vip: isVip(u),
        vipUntil: u.vipUntil,
        freeMatchesLeft: freeMatchesLeft(u),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("[api/session] failed:", e); // full detail goes to the server logs only
    const { status, code, hint } = classify(e);
    return NextResponse.json(
      {
        error: code,
        hint,
        // Raw error text only outside production (it can name internal tables/keys).
        ...(process.env.NODE_ENV !== "production" && { detail: e instanceof Error ? e.message : String(e) }),
      },
      { status, headers: NO_STORE },
    );
  }
}
