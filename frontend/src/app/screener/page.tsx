"use client";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Change from "@/components/Change";
import Disclaimer from "@/components/Disclaimer";
import Logo from "@/components/Logo";
import NavBar from "@/components/NavBar";
import Sparkline from "@/components/Sparkline";
import { api, type ScreenResult } from "@/lib/api";
import { compact, money, num, pct } from "@/lib/format";

const UNIVERSES = [
  { id: "NIFTY50", label: "NIFTY 50" },
  { id: "SENSEX", label: "SENSEX" },
  { id: "BSE", label: "BSE top 150" },
  { id: "NASDAQ", label: "NASDAQ large caps" },
  { id: "SP500", label: "S&P 500" },
  { id: "GOLD_SILVER_IN", label: "Gold & silver ETFs (India)" },
  { id: "GOLD_SILVER_US", label: "Gold & silver ETFs (US)" },
];

const SORTS = [
  { id: "score", label: "Composite score" },
  { id: "buyers", label: "Buying pressure" },
  { id: "volume", label: "Volume" },
  { id: "volume_surge", label: "Volume surge" },
  { id: "profit", label: "Profit margin" },
  { id: "momentum", label: "3-month return" },
  { id: "return_1m", label: "1-month return" },
  { id: "market_cap", label: "Market cap" },
  { id: "pe", label: "Lowest P/E" },
];

const NUMERIC_FILTERS = [
  { key: "min_volume", label: "Min avg volume", placeholder: "e.g. 1000000" },
  { key: "min_volume_surge", label: "Min volume surge (×)", placeholder: "e.g. 1.2" },
  { key: "min_buying_pressure", label: "Min buying pressure", placeholder: "-1 to 1, e.g. 0.05" },
  { key: "min_profit_margin", label: "Min profit margin %", placeholder: "e.g. 10" },
  { key: "max_pe", label: "Max P/E", placeholder: "e.g. 30" },
  { key: "min_return_1m", label: "Min 1M return %", placeholder: "e.g. 0" },
  { key: "min_return_3m", label: "Min 3M return %", placeholder: "e.g. 5" },
  { key: "max_price", label: "Max price", placeholder: "any" },
] as const;

type FilterKey = (typeof NUMERIC_FILTERS)[number]["key"];

export default function ScreenerPage() {
  return (
    <Suspense>
      <Screener />
    </Suspense>
  );
}

function Screener() {
  const requested = useSearchParams().get("universe");
  const [universe, setUniverse] = useState(UNIVERSES.some((x) => x.id === requested) ? requested! : "NIFTY50");
  const [sort, setSort] = useState("score");
  const [sector, setSector] = useState("");
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const [data, setData] = useState<ScreenResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ universe, sort, limit: "50" });
    if (sector) params.set("sector", sector);
    for (const [k, v] of Object.entries(filters)) if (v && !Number.isNaN(Number(v))) params.set(k, v);
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api<ScreenResult>(`/suggest?${params}`);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [universe, sort, sector, filters]);

  function pickUniverse(id: string) {
    setUniverse(id);
    setSector("");
    window.history.replaceState(null, "", `/screener?universe=${id}`);
  }

  const cur = data?.currency ?? null;
  const input = "h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm outline-none focus:border-accent";

  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <h1 className="text-2xl font-semibold">Stock screener</h1>
        <p className="mt-1 text-sm text-ink-2">
          Rank an exchange&apos;s stocks by volume, buying pressure, profitability and momentum. Scans refresh every 30 minutes.
        </p>

        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Exchange">
          {UNIVERSES.map((u) => (
            <button
              key={u.id}
              role="tab"
              aria-selected={universe === u.id}
              onClick={() => pickUniverse(u.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${universe === u.id ? "border-accent bg-accent text-white" : "border-line text-ink-2 hover:bg-surface-2"}`}
            >
              {u.label}
            </button>
          ))}
        </div>

        <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <label className="text-xs text-muted">
              Sort by
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${input} mt-1 text-ink`}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">
              Sector
              <select value={sector} onChange={(e) => setSector(e.target.value)} className={`${input} mt-1 text-ink`}>
                <option value="">All sectors</option>
                {(data?.sectors ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {NUMERIC_FILTERS.map((f) => (
              <label key={f.key} className="text-xs text-muted">
                {f.label}
                <input
                  inputMode="decimal"
                  value={filters[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setFilters((p) => ({ ...p, [f.key]: e.target.value }))}
                  className={`${input} num mt-1 text-ink placeholder:text-muted`}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>
              {data && <>Showing <b className="text-ink">{Math.min(data.matched, 50)}</b> of {data.matched} matches ({data.scanned} stocks scanned)</>}
            </span>
            <button onClick={() => { setFilters({}); setSector(""); setSort("score"); }} className="inline-flex items-center gap-1 hover:text-ink">
              <RotateCcw size={12} aria-hidden /> Reset filters
            </button>
          </div>
        </section>

        {error && (
          <p className="mt-4 flex items-center gap-2 text-sm text-down" role="alert">
            <AlertCircle size={16} /> {error}
          </p>
        )}

        <section className="relative mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-start justify-center bg-surface/70 pt-16 text-sm text-ink-2">
              <span className="flex items-center gap-2">
                <Loader2 className="animate-spin" size={16} aria-hidden />
                {data ? "Updating…" : "Scanning the exchange. The first scan takes up to a minute while fundamentals download."}
              </span>
            </div>
          )}
          <table className="num w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">1D</th>
                <th className="px-3 py-2 text-right font-medium">1M</th>
                <th className="px-3 py-2 text-right font-medium">3M</th>
                <th className="px-3 py-2 text-right font-medium" title="20-day average daily volume">Avg vol</th>
                <th className="px-3 py-2 text-right font-medium" title="5-day volume ÷ 20-day average">Vol surge</th>
                <th className="px-3 py-2 text-right font-medium" title="Chaikin Money Flow (20d): above 0 means closes near the day's high on heavy volume (net buying)">Buying pressure</th>
                <th className="px-3 py-2 text-right font-medium">Profit margin</th>
                <th className="px-3 py-2 text-right font-medium">P/E</th>
                <th className="px-3 py-2 text-right font-medium">Mkt cap</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                <th className="px-3 py-2 font-medium">30 days</th>
              </tr>
            </thead>
            <tbody>
              {!data && !loading && !error && (
                <tr><td colSpan={14} className="px-3 py-16 text-center text-muted">Pick an exchange to scan.</td></tr>
              )}
              {data?.results.length === 0 && (
                <tr><td colSpan={14} className="px-3 py-16 text-center text-muted">No stocks match these filters.</td></tr>
              )}
              {data?.results.map((r, i) => (
                <tr key={r.symbol} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2 text-muted">{i + 1}</td>
                  <td className="max-w-[260px] px-3 py-2">
                    <div className="flex items-center gap-2.5">
                    <Logo symbol={r.symbol} name={r.name} size={30} />
                    <div className="min-w-0">
                    <Link href={`/stock/${encodeURIComponent(r.symbol)}`} className="font-semibold hover:text-accent-ink">{r.symbol}</Link>
                    <div className="truncate text-xs text-ink-2">{r.name}</div>
                    {data.latest && r.as_of < data.latest && (
                      <div className="text-xs text-warn" title="Yahoo Finance hasn't published a later daily bar for this symbol">price as of {r.as_of}</div>
                    )}
                    </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{money(r.price, cur)}</td>
                  <td className="px-3 py-2 text-right"><Change value={r.change_pct} /></td>
                  <td className="px-3 py-2 text-right"><Change value={r.return_1m} digits={1} /></td>
                  <td className="px-3 py-2 text-right"><Change value={r.return_3m} digits={1} /></td>
                  <td className="px-3 py-2 text-right">{compact(r.avg_volume)}</td>
                  <td className="px-3 py-2 text-right">{r.volume_surge != null ? `${r.volume_surge.toFixed(2)}×` : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.buying_pressure > 0 ? "+" : ""}{r.buying_pressure.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.profit_margin, 1, false)}</td>
                  <td className="px-3 py-2 text-right">{num(r.pe, 1)}</td>
                  <td className="px-3 py-2 text-right">{compact(r.market_cap, cur)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{r.score.toFixed(0)}</td>
                  <td className="px-3 py-2"><Sparkline values={r.spark} width={80} height={24} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <details className="mt-4 text-sm text-ink-2">
          <summary className="cursor-pointer text-accent-ink">How the score works</summary>
          <div className="mt-2 space-y-2">
            <p>
              The composite score (0–100) ranks each stock against the others in the same exchange: 3-month return 25%, buying pressure 20%,
              profit margin 20%, low volatility 15%, 1-month return 10%, volume surge 10%.
            </p>
            <p>
              <b>Buying pressure</b> is Chaikin Money Flow over 20 days. Free data sources don&apos;t publish buyer and seller counts, so this is
              estimated from where each day closes within its range, weighted by volume. Fundamentals (margin, P/E, market cap) are
              fetched for every stock and cached for a day. For BSE stocks with an incomplete Yahoo feed, prices come from the same company&apos;s NSE listing.
            </p>
          </div>
        </details>

        <div className="mt-8">
          <Disclaimer />
        </div>
      </main>
    </>
  );
}
