import { NextResponse } from "next/server";
import { iceServers } from "@/lib/ice";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  await getUser();
  return NextResponse.json({ iceServers: iceServers() });
}
