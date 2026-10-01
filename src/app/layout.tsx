import type { Metadata } from "next";
import Analytics from "@/components/Analytics";
import CookieConsent from "@/components/CookieConsent";
import Header from "@/components/Header";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "RandomChat – meet someone new", template: "%s | RandomChat" },
  description: "Free random 1-to-1 video chat with built-in text translation. Adults 18+ only.",
  openGraph: {
    title: "RandomChat – meet someone new",
    description: "Free random 1-to-1 video chat with built-in text translation.",
    url: siteUrl,
    siteName: "RandomChat",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Header />
        <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-24 pt-8 text-xs text-neutral-500">
          <p>18+ only. Don&apos;t share personal info.</p>
          <nav className="mt-2 flex flex-wrap gap-4" aria-label="Footer">
            <a className="underline" href="/faq">FAQ</a>
            <a className="underline" href="/privacy">Privacy</a>
            <a className="underline" href="/terms">Terms</a>
            <a className="underline" href="/pricing">Premium</a>
          </nav>
        </footer>
        <CookieConsent />
        <Analytics />
      </body>
    </html>
  );
}
