import { NextResponse } from "next/server";
import { z } from "zod";
import { COUNTRY_CODES } from "@/lib/countries";
import { getUser } from "@/lib/session";
import { isPremium, joinQueue } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  filter: z.enum(["both", "boys", "girls"]).default("both"),
  country: z.string().refine((c) => c === "any" || COUNTRY_CODES.includes(c)).default("any"),
});

export async function POST(req: Request) {
  const u = await getUser();
  if (!u.ageVerified) return NextResponse.json({ error: "age_verification_required" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  // The gender filter is Premium-only (a VIP pass does not unlock them).
  // The location filter is open to everyone; free users get blurred location matches.
  if (parsed.data.filter !== "both" && !isPremium(u)) {
    return NextResponse.json({ error: "premium_required" }, { status: 403 });
  }
  return NextResponse.json(joinQueue(u, parsed.data.filter, parsed.data.country));
}
