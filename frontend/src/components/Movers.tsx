"use client";
import { AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { compact, money, pct } from "@/lib/format";
import Change from "./Change";
import Logo from "./Logo";
import Sparkline from "./Sparkline";

type MoverItem = {
  symbol: string; name: string; price: number; change_pct: number; volume: number; turnover_today: number;
  volume_surge: number | null; profit_margin: number | null; high_52w: number; low_52w: number;
  from_high: number; from_low: number; return_3m: number | null; spark: number[]; as_of: string;
};
type Category = { label: string; field: string; description: string; items: MoverItem[] };
type MoversData = {
  universe: string; label: string; currency: string; as_of: string; advances: number; declines: number;
  scanned: number; categories: Record<string, Category>;
};

const UNIVERSES = [
  { id: "NIFTY50", label: "NIFTY 50" },
  { id: "SENSEX", label: "SENSEX" },
  { id: "BSE", label: "BSE 150" },
  { id: "NASDAQ", label: "NASDAQ" },
  { id: "SP500", label: "S&P 500" },
];
const OVERVIEW = ["gainers", "losers", "active", "profitable"];
const TABS: Record<string, string> = {
  overview: "Overview", gainers: "Top gainers", losers: "Top losers", active: "Most active", volume: "Highest volume",
  shockers: "Volume shockers", profitable: "Most profitable", near_high: "Near 52W high", near_low: "Near 52W low",
  momentum: "Top 3M performers",
};

function metric(cat: string, m: MoverItem, cur: string) {
  switch (cat) {
    case "active": return `${compact(m.turnover_today, cur)} traded`;
    case "volume": return `${compact(m.volume)} shares`;
    case "shockers": return m.volume_surge != null ? `${m.volume_surge.toFixed(2)}× usual volume` : "—";
    case "profitable": return `${pct(m.profit_margin, 1, false)} net margin`;
    case "near_high": return `${Math.abs(m.from_high).toFixed(1)}% below 52W high`;
    case "near_low": return `${m.from_low.toFixed(1)}% above 52W low`;
    case "momentum": return `${pct(m.return_3m, 1)} in 3 months`;
    default: return `Vol ${compact(m.volume)}`;
  }
}

function MiniList({ id, cat, cur, onMore }: { id: string; cat: Category; cur: string; onMore: () => void }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{cat.label}</h3>
        <button onClick={onMore} className="inline-flex items-center gap-0.5 text-xs text-accent-ink hover:underline">
          See all <ArrowRight size={12} aria-hidden />
        </button>
      </div>
      {cat.items.length === 0 && <p className="py-6 text-center text-sm text-muted">None in this session.</p>}
      <ul className="stagger">
        {cat.items.slice(0, 5).map((m) => (
          <li key={m.symbol}>
            <Link href={`/stock/${encodeURIComponent(m.symbol)}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
              <Logo symbol={m.symbol} name={m.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.name}</div>
                <div className="truncate text-xs text-muted">{id === "gainers" || id === "losers" ? m.symbol.replace(/\.(NS|BO)$/, "") : metric(id, m, cur)}</div>
              </div>
              <div className="text-right">
                <div className="num text-sm">{money(m.price, cur)}</div>
                <Change value={m.change_pct} className="text-xs" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Movers() {
  const [universe, setUniverse] = useState("NIFTY50");
  const [tab, setTab] = useState("overview");
  const [cache, setCache] = useState<Record<string, MoversData>>({});
  const [error, setError] = useState<{ universe: string; message: string } | null>(null);
  const data = cache[universe];

  useEffect(() => {
    if (cache[universe]) return;
    let cancelled = false;
    api<MoversData>(`/movers?universe=${universe}&limit=12`)
      .then((d) => !cancelled && setCache((c) => ({ ...c, [universe]: d })))
      .catch((e) => !cancelled && setError({ universe, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [universe, cache]);

  const err = error?.universe === universe ? error.message : null;
  const cur = data?.currency ?? "INR";
  const total = data ? data.advances + data.declines : 0;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Market movers</h2>
          <p className="text-xs text-muted">
            {data ? <>Last session {data.as_of} · {data.scanned} stocks in {data.label}</> : "Scanning the market…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Market">
          {UNIVERSES.map((u) => (
            <button
              key={u.id}
              role="tab"
              aria-selected={universe === u.id}
              onClick={() => setUniverse(u.id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${universe === u.id ? "border-accent bg-accent text-white" : "border-line text-ink-2 hover:bg-surface-2"}`}
            >
              {u.label}
            </button>
          ))}
        </div>
      </div>

      {data && total > 0 && (
        <div className="mb-4 animate-fade-in">
          <div className="flex h-2 overflow-hidden rounded-full" role="img" aria-label={`${data.advances} advancing, ${data.declines} declining`}>
            <div style={{ width: `${(data.advances / total) * 100}%`, background: "var(--candle-up)" }} />
            <div className="w-0.5 bg-surface" />
            <div style={{ width: `${(data.declines / total) * 100}%`, background: "var(--candle-down)" }} />
          </div>
          <div className="num mt-1 flex justify-between text-xs">
            <span className="text-up">▲ {data.advances} advancing</span>
            <span className="text-down">{data.declines} declining ▼</span>
          </div>
        </div>
      )}

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Category">
        {Object.entries(TABS).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${tab === t ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {err && (
        <p className="flex items-center gap-2 text-sm text-down" role="alert"><AlertCircle size={16} /> {err}</p>
      )}

      {!data && !err && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-72 rounded-2xl border border-line" />)}
        </div>
      )}

      {data && tab === "overview" && (
        <div key={universe} className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {OVERVIEW.map((id) => (
            <MiniList key={id} id={id} cat={data.categories[id]} cur={cur} onMore={() => setTab(id)} />
          ))}
        </div>
      )}

      {data && tab !== "overview" && (
        <div key={`${universe}-${tab}`}>
          <p className="mb-3 text-sm text-ink-2">{data.categories[tab].description}</p>
          {data.categories[tab].items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No stocks in this category for the last session.</p>
          ) : (
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.categories[tab].items.map((m, i) => (
                <Link
                  key={m.symbol}
                  href={`/stock/${encodeURIComponent(m.symbol)}`}
                  className="group flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Logo symbol={m.symbol} name={m.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted">#{i + 1} · {m.symbol}</div>
                      <div className="truncate text-sm font-medium">{m.name}</div>
                    </div>
                    <Sparkline values={m.spark} width={64} height={26} />
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="num text-lg font-semibold">{money(m.price, cur)}</span>
                      <Change value={m.change_pct} className="text-sm" />
                    </div>
                    <div className="mt-1 text-xs text-ink-2">{metric(tab, m, cur)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-3 text-right">
            <Link href={`/screener?universe=${universe}`} className="inline-flex items-center gap-1 text-sm text-accent-ink hover:underline">
              Filter further in the screener <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
