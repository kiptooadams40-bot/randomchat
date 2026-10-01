import Image from "next/image";
import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b border-white/10">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Image src="/logo.svg" alt="RandomChat logo" width={28} height={28} unoptimized priority />
          <span>Random<span className="text-violet-400">Chat</span></span>
        </Link>
        <div className="flex items-center gap-4 text-sm text-neutral-300">
          <Link href="/faq" className="hidden hover:text-white sm:inline">FAQ</Link>
          <Link href="/pricing" className="hover:text-white">Premium</Link>
          <Link href="/invite" className="hover:text-white">Invite</Link>
          <Link href="/account" className="hidden hover:text-white sm:inline">Account</Link>
          <Link href="/chat" className="rounded-full bg-violet-600 px-4 py-1.5 font-medium text-white hover:bg-violet-500">
            Start chatting
          </Link>
        </div>
      </nav>
    </header>
  );
}
