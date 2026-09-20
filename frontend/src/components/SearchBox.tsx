"use client";
import { Layers, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api, type SearchResult } from "@/lib/api";
import Logo from "./Logo";
import { startRouteProgress } from "./RouteProgress";

const EXCHANGES = ["All", "NASDAQ", "NYSE", "BSE", "NSE", "INDEX", "COMMODITY"];

export default function SearchBox({ autoFocus = false, compact = false, basePath = "/stock" }: { autoFocus?: boolean; compact?: boolean; basePath?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [exchange, setExchange] = useState("All");
  const [result, setResult] = useState<SearchResult>({ stocks: [], sectors: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const term = q.trim();
  // One keyboard-navigable list: sectors first, then stocks.
  type Item = { kind: "sector"; slug: string; name: string; sub: string } | { kind: "stock"; hit: SearchResult["stocks"][number] };
  const shown: Item[] = term
    ? [
        ...(basePath === "/stock" ? result.sectors : []).map((x) => ({ kind: "sector" as const, slug: x.slug, name: x.name, sub: `${x.count} stocks · ${x.source}` })),
        ...result.stocks.map((hit) => ({ kind: "stock" as const, hit })),
      ]
    : [];

  useEffect(() => {
    if (!term) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const ex = exchange === "All" ? "" : `&exchange=${encodeURIComponent(exchange)}`;
        setResult(await api<SearchResult>(`/search?q=${encodeURIComponent(term)}${ex}&limit=12`));
        setActive(0);
      } catch {
        setResult({ stocks: [], sectors: [] });
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [term, exchange]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function go(path: string) {
    setOpen(false);
    setQ("");
    startRouteProgress();
    router.push(path);
  }
  const pathOf = (it: Item) => (it.kind === "sector" ? `/sector/${it.slug}` : `${basePath}/${encodeURIComponent(it.hit.symbol)}`);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (shown[active]) go(pathOf(shown[active]));
      else if (q.trim()) go(`${basePath}/${encodeURIComponent(q.trim().toUpperCase())}`);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={box} className="relative z-40 w-full">
      <div className={`flex items-center gap-2 rounded-xl border border-line bg-surface focus-within:border-accent ${compact ? "h-9 px-2" : "h-12 px-3"}`}>
        <Search size={compact ? 15 : 18} className="shrink-0 text-muted" aria-hidden />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={compact ? "Search stocks or sectors…" : "Search a stock, symbol or sector: Apple, RELIANCE, defence, energy…"}
          aria-label="Search stocks"
          role="combobox"
          aria-controls={listId}
          aria-expanded={open && shown.length > 0}
          className={`min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted ${compact ? "text-sm" : "text-base"}`}
        />
        {loading && term && <Loader2 size={15} className="animate-spin text-muted" aria-hidden />}
        {!compact && (
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
            aria-label="Exchange"
            className="rounded-lg bg-surface-2 px-2 py-1 text-sm text-ink-2 outline-none"
          >
            {EXCHANGES.map((x) => (
              <option key={x} value={x}>{x === "INDEX" ? "Indices" : x === "COMMODITY" ? "Commodities" : x}</option>
            ))}
          </select>
        )}
      </div>
      {open && shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-[26rem] w-full animate-fade-in overflow-auto rounded-xl border border-line bg-surface py-1 text-left shadow-xl"
        >
          {shown.map((it, i) => {
            const first = i === 0 || shown[i - 1].kind !== it.kind;
            return (
              <li key={it.kind === "sector" ? `s:${it.slug}` : it.hit.symbol} role="option" aria-selected={i === active}>
                {first && (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {it.kind === "sector" ? "Sectors & themes" : "Stocks & ETFs"}
                  </div>
                )}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(pathOf(it))}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? "bg-surface-2" : ""}`}
                >
                  {it.kind === "sector" ? (
                    <>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Layers size={15} aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{it.name}</span>
                        <span className="block truncate text-xs text-muted">{it.sub}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <Logo symbol={it.hit.symbol} name={it.hit.name} size={28} />
                      <span className="num w-28 shrink-0 truncate text-sm font-semibold">{it.hit.symbol}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{it.hit.name}</span>
                      <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                        {it.hit.via_sector ? "In sector · " : ""}
                        {it.hit.type === "ETF" ? "ETF · " : ""}
                        {it.hit.exchange === "INDEX" ? "Index" : it.hit.exchange === "COMMODITY" ? "Commodity" : it.hit.exchange}
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
