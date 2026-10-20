import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prepareAccountDelete } from "@/lib/repo";
import { authClient, getUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Deletes the signed-in account. Orders and payments are kept for accounting with the
 * user id and any email / phone cleared; everything else tied to the account is deleted.
 */
export async function POST(req: Request) {
  if ((await req.json().catch(() => null))?.confirm !== "DELETE") {
    return NextResponse.json({ error: "confirm_required" }, { status: 400 });
  }
  const u = await getUser();
  if (u.anonymous) return NextResponse.json({ error: "not_signed_in" }, { status: 403 });

  await prepareAccountDelete(u.id);
  await authClient(await cookies()).auth.signOut({ scope: "global" }).catch(() => {});
  const { error } = await supabaseAdmin().auth.admin.deleteUser(u.id);
  if (error) {
    console.error("[api/account/delete] failed:", u.id, error.message);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
