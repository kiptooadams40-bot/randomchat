import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authClient } from "@/lib/session";

export const dynamic = "force-dynamic";

/** { all: true } signs out every device (each one notices on its next request). */
export async function POST(req: Request) {
  const all = (await req.json().catch(() => null))?.all === true;
  const sb = authClient(await cookies());
  const { error } = await sb.auth.signOut({ scope: all ? "global" : "local" });
  if (error) console.error("[api/auth/signout] failed:", error.message);
  return NextResponse.json({ ok: !error });
}
