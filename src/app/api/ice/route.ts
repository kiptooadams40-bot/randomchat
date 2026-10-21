import { NextResponse } from "next/server";
import { iceServers } from "@/lib/ice";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Short-lived TURN credentials for this visitor (fetched when they tap Start). */
export async function GET() {
  await getUser();
  return NextResponse.json(await iceServers(), { headers: { "Cache-Control": "no-store" } });
}
