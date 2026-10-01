import { NextResponse } from "next/server";
import { z } from "zod";
import { isProd } from "@/lib/env";
import { getUser } from "@/lib/session";

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
  // A self-declared birth date is NOT real age assurance. Fail closed in prod.
  if (false) {
    return NextResponse.json(
      { error: "Age assurance provider not configured (mock is refused in production)." },
      { status: 503 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid birth date" }, { status: 400 });
  const age = ageOf(parsed.data.birthDate);
  if (age < 18) return NextResponse.json({ error: "You must be 18 or older." }, { status: 403 });
  const u = await getUser();
  u.ageVerified = true;
  return NextResponse.json({ ok: true });
}
