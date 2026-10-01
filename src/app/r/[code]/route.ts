import { NextResponse } from "next/server";
import { referrerExists } from "@/lib/repo";
import { REF_COOKIE, cookieOptions } from "@/lib/session";

/** Referral landing: remember who invited this visitor, then send them home. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = NextResponse.redirect(new URL("/", req.url));
  if (/^[0-9a-f]{8}$/.test(code) && (await referrerExists(code).catch(() => false))) {
    res.cookies.set(REF_COOKIE, code, cookieOptions());
  }
  return res;
}
