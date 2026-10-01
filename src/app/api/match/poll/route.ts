import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { pollMatch } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  return NextResponse.json(pollMatch(u.id));
}
