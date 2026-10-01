import { NextResponse } from "next/server";
import { pollMatch } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  return NextResponse.json(await pollMatch(u.id));
}
