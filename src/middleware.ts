import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, supabasePublicConfigured } from "@/lib/supabase-keys";

const REF_COOKIE = "rc_ref"; // same name as REF_COOKIE in lib/session.ts
const REF_CODE = /^[0-9a-f]{8}$/;

/**
 * Keeps the Supabase session fresh (access tokens expire hourly; the refresh must be
 * written to cookies, which Server Components cannot do), and remembers an invite
 * code arriving as ?ref=<code>. The code stays in the URL so "Open in Chrome" keeps it.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const withRef = (res: NextResponse) => {
    const ref = request.nextUrl.searchParams.get("ref");
    if (ref && REF_CODE.test(ref) && request.cookies.get(REF_COOKIE)?.value !== ref) {
      res.cookies.set(REF_COOKIE, ref, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return res;
  };
  if (!supabasePublicConfigured()) return withRef(response);

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getClaims(); // refreshes the session if the access token expired
  return withRef(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html)$).*)"],
};
