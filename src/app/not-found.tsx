import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-6xl font-extrabold text-violet-400">404</p>
      <h1 className="mt-4 text-2xl font-bold">This page wandered off.</h1>
      <p className="mt-2 text-neutral-400">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="rounded-full border border-white/20 px-6 py-2.5 hover:bg-white/5">Go home</Link>
        <Link href="/chat" className="rounded-full bg-violet-600 px-6 py-2.5 font-medium hover:bg-violet-500">Start chatting</Link>
      </div>
    </div>
  );
}
