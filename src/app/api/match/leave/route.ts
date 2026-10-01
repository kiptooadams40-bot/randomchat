import { NextResponse } from "next/server";
import { leave } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const u = await getUser();
  await leave(u.id);
  return NextResponse.json({ ok: true });
}
