"use client";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type User } from "@/lib/api";
import SearchBox from "./SearchBox";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Markets" },
  { href: "/screener", label: "Screener" },
  { href: "/scalper", label: "Scalper" },
  { href: "/profile", label: "Portfolio" },
];

export default function NavBar() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api<User>("/auth/me").then(setUser).catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 py-1">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="font-brand">BullSight</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm ${pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href)) ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden w-72 md:block">{pathname !== "/" && !pathname.startsWith("/scalper") && <SearchBox compact />}</div>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <ThemeToggle />
          {user && (
            <>
            <Link href="/profile" className="flex items-center gap-2 rounded-lg px-1 hover:bg-surface-2" title="Your profile & portfolio">
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-sm font-medium">
                  {user.name.slice(0, 1)}
                </span>
              )}
              <span className="hidden text-sm text-ink-2 lg:inline">{user.name}</span>
            </Link>
            <div className="flex items-center">
              <button
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                <LogOut size={16} />
              </button>
            </div>
            </>
          )}
        </div>
      </div>
      <nav className="flex gap-1 border-t border-line px-4 py-1 sm:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1 text-sm ${pathname === l.href ? "bg-surface-2" : "text-ink-2"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
