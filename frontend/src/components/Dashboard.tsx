"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import Change from "./Change";
import Disclaimer from "./Disclaimer";
import Logo from "./Logo";
import LoginReceipt from "./LoginReceipt";
import NavBar from "./NavBar";
import Movers from "./Movers";
import SearchBox from "./SearchBox";
import Sparkline from "./Sparkline";
import { api, type IndexQuote, type User } from "@/lib/api";
import { money } from "@/lib/format";

type Exchanges = { counts: Record<string, number>; universes: { id: string; label: string }[] };

const POPULAR = [
  { symbol: "AAPL", label: "Apple" },
  { symbol: "NVDA", label: "NVIDIA" },
  { symbol: "MSFT", label: "Microsoft" },
  { symbol: "RELIANCE.NS", label: "Reliance" },
  { symbol: "TCS.NS", label: "TCS" },
  { symbol: "HDFCBANK.BO", label: "HDFC Bank (BSE)" },
  { symbol: "INFY.NS", label: "Infosys" },
  { symbol: "GOLDBEES.NS", label: "Gold BeES" },
  { symbol: "SILVERBEES.NS", label: "Silver BeES" },
];

export default function Dashboard() {
  const [indices, setIndices] = useState<IndexQuote[] | null>(null);
  const [ex, setEx] = useState<Exchanges | null>(null);
  const [metals, setMetals] = useState<IndexQuote[] | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    api<IndexQuote[]>("/markets").then((q) => setIndices(q.filter((x) => x.symbol.startsWith("^")))).catch(() => setIndices([]));
    api<Exchanges>("/exchanges").then(setEx).catch(() => {});
    api<IndexQuote[]>("/metals").then(setMetals).catch(() => setMetals([]));
    api<User>("/auth/me").then(setUser).catch(() => {});
  }, []);

  const greetingText = user ? `Hi ${user.name.split(" ")[0]}, let's analyze some stocks` : "Let's analyze some stocks";

  // Reveal the greeting one letter at a time; each character fades in on mount (see .letter-in
  // in globals.css) for a smooth typewriter, restarting once the user's name loads in. The first
  // tick sets the count to 0 (rather than a synchronous reset in the effect body).
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      setCharCount(i);
      i += 1;
      if (i > greetingText.length) clearInterval(id);
    }, 55);
    return () => clearInterval(id);
  }, [greetingText]);

  const isTyping = charCount < greetingText.length;

  const c = ex?.counts ?? {};
  const us = (c.NYSE ?? 0) + (c["NYSE American"] ?? 0) + (c["NYSE Arca"] ?? 0) + (c["Cboe BZX"] ?? 0);

  return (
    <>
      <NavBar />
      <LoginReceipt />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <section className="relative z-30 mx-auto max-w-2xl animate-fade-up py-6 text-center">
          <h1 className="font-brand text-2xl leading-tight tracking-tight sm:text-3xl min-h-[88px]">
            {Array.from(greetingText.slice(0, charCount)).map((ch, i) =>
              ch === " " ? (
                <span key={i} className="letter-in inline-block w-[0.3em]" aria-hidden />
              ) : (
                <span key={i} className="letter-in inline-block">{ch}</span>
              ),
            )}
            {isTyping && <span className="typewriter-cursor ml-1 inline-block w-0.5 h-7 bg-accent align-middle" aria-hidden />}
          </h1>
          <p className="mt-2 text-ink-2">
            {ex ? (
              <>
                <span className="num">{(c.NASDAQ ?? 0).toLocaleString()}</span> NASDAQ ·{" "}
                <span className="num">{(c.BSE ?? 0).toLocaleString()}</span> BSE ·{" "}
                <span className="num">{(c.NSE ?? 0).toLocaleString()}</span> NSE ·{" "}
                <span className="num">{us.toLocaleString()}</span> NYSE &amp; other US listings
              </>
            ) : (
              "Loading exchange listings…"
            )}
          </p>
          <div className="mt-6">
            <SearchBox autoFocus />
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {POPULAR.map((p) => (
              <Link key={p.symbol} href={`/stock/${p.symbol}`} className="rounded-full border border-line px-3 py-1 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                {p.label}
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-ink-2">Indices</h2>
          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(indices ?? Array.from({ length: 4 }, () => null)).map((q, i) =>
              q ? (
                <Link key={q.symbol} href={`/stock/${encodeURIComponent(q.symbol)}`} className="group rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm text-ink-2">{q.name}</div>
                      <div className="num mt-1 text-xl font-semibold">{money(q.price, null)}</div>
                      <Change value={q.change_pct} className="text-sm" />
                    </div>
                    <Sparkline values={q.spark} />
                  </div>
                  <div className="mt-3 flex items-center gap-1 text-xs text-muted group-hover:text-accent-ink">
                    Forecast <ArrowRight size={12} aria-hidden />
                  </div>
                </Link>
              ) : (
                <div key={i} className="skeleton h-32 rounded-2xl border border-line" />
              ),
            )}
          </div>
          {indices?.length === 0 && <p className="text-sm text-down">Couldn&apos;t load index quotes.</p>}
        </section>

        <div className="mt-10">
          <Movers />
        </div>

        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-2">Gold &amp; silver</h2>
            <div className="flex gap-3 text-sm">
              <Link href="/screener?universe=GOLD_SILVER_IN" className="text-accent-ink hover:underline">All Indian ETFs</Link>
              <Link href="/screener?universe=GOLD_SILVER_US" className="text-accent-ink hover:underline">All US ETFs</Link>
            </div>
          </div>
          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(metals ?? Array.from({ length: 6 }, () => null)).map((q, i) =>
              q ? (
                <Link key={q.symbol} href={`/stock/${encodeURIComponent(q.symbol)}`} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent">
                  <Logo symbol={q.symbol} name={q.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-2">{q.name}</div>
                    <div className="text-xs text-muted">{q.symbol}</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="num text-lg font-semibold">{money(q.price, q.currency)}</span>
                      <Change value={q.change_pct} className="text-sm" />
                    </div>
                  </div>
                  <Sparkline values={q.spark} />
                </Link>
              ) : (
                <div key={i} className="skeleton h-24 rounded-2xl border border-line" />
              ),
            )}
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-2">Screen an exchange</h2>
            <Link href="/screener" className="text-sm text-accent-ink hover:underline">Open screener</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(ex?.universes ?? []).map((u) => (
              <Link key={u.id} href={`/screener?universe=${u.id}`} className="rounded-xl border border-line bg-surface px-4 py-3 text-sm hover:border-accent">
                {u.label}
              </Link>
            ))}
          </div>
        </section>

        <div className="mt-12">
          <Disclaimer />
        </div>
      </main>
    </>
  );
}
