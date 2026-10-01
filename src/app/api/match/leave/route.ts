import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { leave } from "@/lib/store";

export async function POST() {
  const u = await getUser();
  leave(u.id);
  return NextResponse.json({ ok: true });
}
