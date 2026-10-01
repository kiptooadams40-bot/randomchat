import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string().min(1).max(500),
  to: z.enum(["en", "fr", "es"]),
  from: z.enum(["auto", "en", "fr", "es"]).default("auto"),
});

/**
 * Basic translation via MyMemory's free public API (no key; rate-limited).
 * On any failure the original text is returned so chat never breaks.
 */
export async function POST(req: Request) {
  await getUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { text, to, from } = parsed.data;
  if (from === to) return NextResponse.json({ text, translated: false });
  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text);
    url.searchParams.set("langpair", `${from === "auto" ? "Autodetect" : from}|${to}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    const json = (await res.json()) as { responseData?: { translatedText?: string }; responseStatus?: number };
    const out = json.responseData?.translatedText;
    if (res.ok && json.responseStatus === 200 && out && out !== text) {
      return NextResponse.json({ text: out, translated: true });
    }
  } catch {
    /* fall through to original */
  }
  return NextResponse.json({ text, translated: false });
}
