"use client";
import { AlertCircle, Layers } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import Change from "@/components/Change";
import Disclaimer from "@/components/Disclaimer";
import Loader from "@/components/Loader";
import Logo from "@/components/Logo";
import NavBar from "@/components/NavBar";
import Sparkline from "@/components/Sparkline";
import { api } from "@/lib/api";
import { compact, money } from "@/lib/format";

type Row = { symbol: string; name: string; price: number; change_pct: number; return_1m: number | null; return_1y: number | null; volume: number; spark: number[] };
type Sector = {
  slug: string; name: string; region: string; source: string; currency: string; avg_change_pct: number | null;
  advances: number; declines: number; stocks: Row[];
};

const SORTS = [
  { id: "change_pct", label: "Today" },
  { id: "return_1m", label: "1 month" },
  { id: "return_1y", label: "1 year" },
  { id: "volume", label: "Volume" },
] as const;

export default function SectorView({ slug }: { slug: string }) {
  const [data, setData] = useState<Sector | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("change_pct");

  useEffect(() => {
    api<Sector>(`/sector/${encodeURIComponent(slug)}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const rows = data ? [...data.stocks].sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity)) : [];
  const total = data ? data.advances + data.declines : 0;

  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {error && <p role="alert" className="flex items-center gap-2 text-sm text-down"><AlertCircle size={16} /> {error}</p>}
        {!data && !error && <div className="flex h-80 items-center justify-center"><Loader size="lg" label="Loading sector…" /></div>}
        {data && (
          <div className="animate-fade-up">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-ink-2"><Layers size={16} className="text-accent" aria-hidden /> Sector · {data.source}</div>
                <h1 className="mt-1 text-3xl font-semibold">{data.name}</h1>
                <p className="mt-1 text-sm text-ink-2">{data.stocks.length} stocks</p>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted">Average move today</div>
                <Change value={data.avg_change_pct} className="text-2xl" />
              </div>
            </div>

            {total > 0 && (
              <div className="mt-4">
                <div className="flex h-2 overflow-hidden rounded-full">
                  <div style={{ width: `${(data.advances / total) * 100}%`, background: "var(--candle-up)" }} />
                  <div className="w-0.5 bg-page" />
                  <div style={{ width: `${(data.declines / total) * 100}%`, background: "var(--candle-down)" }} />
                </div>
                <div className="num mt-1 flex justify-between text-xs">
                  <span className="text-up">▲ {data.advances} up</span><span className="text-down">{data.declines} down ▼</span>
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center gap-2">
              <span className="text-xs text-muted">Sort by</span>
              {SORTS.map((s) => (
                <button key={s.id} onClick={() => setSort(s.id)} aria-pressed={sort === s.id}
                  className={`rounded-lg px-3 py-1 text-sm ${sort === s.id ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"}`}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="num w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Stock</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th><th className="px-3 py-2 text-right font-medium">Today</th>
                  <th className="px-3 py-2 text-right font-medium">1M</th><th className="px-3 py-2 text-right font-medium">1Y</th>
                  <th className="px-3 py-2 text-right font-medium">Volume</th><th className="px-3 py-2 font-medium">30 days</th>
                </tr></thead>
                <tbody className="stagger">
                  {rows.map((r, i) => (
                    <tr key={r.symbol} className="border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="px-3 py-2 text-muted">{i + 1}</td>
                      <td className="max-w-[300px] px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <Logo symbol={r.symbol} name={r.name} size={30} />
                          <div className="min-w-0">
                            <Link href={`/stock/${encodeURIComponent(r.symbol)}`} className="font-semibold hover:text-accent-ink">{r.symbol}</Link>
                            <div className="truncate text-xs text-ink-2">{r.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">{money(r.price, data.currency)}</td>
                      <td className="px-3 py-2 text-right"><Change value={r.change_pct} /></td>
                      <td className="px-3 py-2 text-right"><Change value={r.return_1m} digits={1} /></td>
                      <td className="px-3 py-2 text-right"><Change value={r.return_1y} digits={1} /></td>
                      <td className="px-3 py-2 text-right">{compact(r.volume)}</td>
                      <td className="px-3 py-2"><Sparkline values={r.spark} width={80} height={24} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-8"><Disclaimer /></div>
          </div>
        )}
      </main>
    </>
  );
}
