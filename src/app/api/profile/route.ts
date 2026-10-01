import { NextResponse } from "next/server";
import { z } from "zod";
import { COUNTRY_CODES } from "@/lib/countries";
import { getUser } from "@/lib/session";

// Both fields optional so the UI can update either independently.
const Body = z.object({
  gender: z.enum(["boy", "girl", "none"]).optional(),
  country: z.string().refine((c) => c === "none" || COUNTRY_CODES.includes(c)).optional(),
});

export async function POST(req: Request) {
  const u = await getUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { gender, country } = parsed.data;
  if (gender !== undefined) u.gender = gender === "none" ? null : gender;
  if (country !== undefined) u.country = country === "none" ? null : country;
  return NextResponse.json({ ok: true, gender: u.gender, country: u.country });
}
