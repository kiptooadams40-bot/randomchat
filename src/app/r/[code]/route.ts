import { NextResponse } from "next/server";
import { isProd } from "@/lib/env";
import { REF_COOKIE } from "@/lib/session";
import { db } from "@/lib/store";

/** Referral landing: remember who invited this visitor, then send them home. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = NextResponse.redirect(new URL("/", req.url));
  if (db.codes.has(code)) {
    res.cookies.set(REF_COOKIE, code, {
      httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}
