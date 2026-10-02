import { NextResponse } from "next/server";
import { z } from "zod";
import { setAgeVerified } from "@/lib/repo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

function ageOf(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return -1;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export async function POST(req: Request) {
  // Note: a self-declared birth date is not real age assurance (swap in a provider before launch).
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid birth date" }, { status: 400 });
    const age = ageOf(parsed.data.birthDate);
    if (age < 18) return NextResponse.json({ error: "You must be 18 or older." }, { status: 403 });

    const u = await getUser();
    // Persisted in Postgres (profiles.age_verified): the single source of truth for every instance.
    await setAgeVerified(u.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/age/verify] failed:", e);
    return NextResponse.json({ error: "Age verification is temporarily unavailable." }, { status: 500 });
  }
}
