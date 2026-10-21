import { NextResponse } from "next/server";
import { referrerExists } from "@/lib/repo";
import { REF_COOKIE, cookieOptions } from "@/lib/session";

/**
 * Referral landing: remember who invited this visitor, then send them home with the code
 * still in the URL (?ref=), so it survives "Open in Chrome" from an in-app browser.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const valid = /^[0-9a-f]{8}$/.test(code) && (await referrerExists(code).catch(() => false));
  const res = NextResponse.redirect(new URL(valid ? `/?ref=${code}` : "/", req.url));
  if (valid) res.cookies.set(REF_COOKIE, code, cookieOptions());
  return res;
}
