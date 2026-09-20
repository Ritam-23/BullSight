"use client";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Analytics } from "@/lib/api";
import { compact, money, pct } from "@/lib/format";
import Change from "./Change";
import Loader from "./Loader";

/** Low–high bar with a marker at the current price (Groww's "Today's low/high" style). */
function RangeBar({ label, low, high, value, currency }: { label: string; low: number; high: number; value: number; currency: string | null }) {
  const pos = high > low ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100)) : 50;
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      <div className="relative h-1.5 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pos}%`, background: "var(--series-1)", opacity: 0.35 }} />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ left: `${pos}%`, background: "var(--series-1)", borderColor: "var(--surface)" }}
          title={money(value, currency)}
        />
      </div>
      <div className="num mt-1.5 flex justify-between text-xs">
        <span><span className="text-muted">L </span>{money(low, currency)}</span>
        <span><span className="text-muted">H </span>{money(high, currency)}</span>
      </div>
    </div>
  );
}

const BIAS = {
  bullish: { Icon: ArrowUpRight, cls: "text-up", label: "Bullish" },
  bearish: { Icon: ArrowDownRight, cls: "text-down", label: "Bearish" },
  neutral: { Icon: Minus, cls: "text-muted", label: "Neutral" },
} as const;

const RETURN_KEYS = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"];

export default function AnalyticsPanel({ symbol, currency }: { symbol: string; currency: string | null }) {
  const [a, setA] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Analytics>(`/analytics/${encodeURIComponent(symbol)}`).then(setA).catch((e) => setError(e.message));
  }, [symbol]);

  if (error) return <p className="text-sm text-down">{error}</p>;
  if (!a)
    return (
      <div className="flex h-40 items-center justify-center text-muted">
        <Loader label="Crunching analytics…" />
      </div>
    );

  const summary = BIAS[a.technical_summary.toLowerCase() as keyof typeof BIAS];
  const levelKeys = ["R3", "R2", "R1", "Pivot", "S1", "S2", "S3"] as const;

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <RangeBar label="Today's low / high" low={a.day.low} high={a.day.high} value={a.price} currency={currency} />
        <RangeBar label="52-week low / high" low={a.week52.low} high={a.week52.high} value={a.price} currency={currency} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Returns</h3>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {RETURN_KEYS.map((k) => (
            <div key={k} className="rounded-lg bg-surface-2 px-2 py-2 text-center">
              <div className="text-xs text-muted">{k}</div>
              <Change value={a.returns[k]} digits={1} className="text-sm" />
            </div>
          ))}
        </div>
        {(a.returns["3Y_CAGR"] != null || a.returns["5Y_CAGR"] != null) && (
          <p className="num mt-2 text-xs text-ink-2">
            Annualised (CAGR): {a.returns["3Y_CAGR"] != null && <>3Y {pct(a.returns["3Y_CAGR"], 1)} </>}
            {a.returns["5Y_CAGR"] != null && <>· 5Y {pct(a.returns["5Y_CAGR"], 1)}</>}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-medium">Technical indicators</h3>
            <span className={`inline-flex items-center gap-1 text-sm font-semibold ${summary.cls}`}>
              <summary.Icon size={15} aria-hidden /> {a.technical_summary}
              <span className="num text-xs font-normal text-muted">
                ({a.signal_counts.bullish} bullish · {a.signal_counts.bearish} bearish · {a.signal_counts.neutral} neutral)
              </span>
            </span>
          </div>
          <table className="num w-full text-sm">
            <tbody>
              {a.signals.map((s) => {
                const b = BIAS[s.bias];
                return (
                  <tr key={s.name} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2 text-ink-2">{s.name}</td>
                    <td className="py-2 pr-2 text-right">
                      {/^(Price vs|SMA 50|Supertrend|Parabolic|Ichimoku)/.test(s.name) ? pct(s.value, 1) : s.name.startsWith("OBV") ? `${s.value > 0 ? "+" : ""}${s.value}× avg vol` : s.value}
                    </td>
                    <td className="py-2 pr-2 text-xs text-muted">
                      {s.signal}
                      {s.last_cross && <div>last {s.last_cross.type.toLowerCase()}: {s.last_cross.date}</div>}
                    </td>
                    <td className={`py-2 text-right ${b.cls}`}>
                      <span className="inline-flex items-center gap-0.5 text-xs font-medium"><b.Icon size={13} aria-hidden />{b.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Support &amp; resistance <span className="font-normal text-muted">(classic pivots)</span></h3>
          <table className="num w-full text-sm">
            <tbody>
              {levelKeys.map((k) => {
                const v = a.levels[k];
                const isPivot = k === "Pivot";
                return (
                  <tr key={k} className={`border-b border-line last:border-0 ${isPivot ? "bg-surface-2" : ""}`}>
                    <td className="px-2 py-1.5 text-ink-2">{k.startsWith("R") ? `Resistance ${k[1]}` : k.startsWith("S") ? `Support ${k[1]}` : "Pivot"}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{money(v, currency)}</td>
                    <td className="px-2 py-1.5 text-right text-xs text-muted">{pct((v / a.price - 1) * 100, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted">From the {a.as_of} session&apos;s high, low and close. Levels traders watch, not predictions.</p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Risk &amp; volume</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Volatility (1Y, annual)", pct(a.risk.volatility_1y, 1, false)],
            ["Max drawdown (1Y)", pct(a.risk.max_drawdown_1y, 1, false)],
            ["Below 52W high", pct(a.risk.from_52w_high, 1, false)],
            ["Up days (1Y)", pct(a.risk.up_days_1y, 0, false)],
            ["Volume today", compact(a.volume.last)],
            ["Avg volume (20D)", compact(a.volume.avg_20d)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-2 px-3 py-2">
              <div className="text-xs text-muted">{label}</div>
              <div className="num mt-0.5 text-sm font-medium">{value}</div>
            </div>
          ))}
        </div>
        <p className="num mt-2 text-xs text-muted">
          All-time range since {a.all_time.since}: {money(a.all_time.low, currency)} – {money(a.all_time.high, currency)}. Deepest fall from a peak: {pct(a.risk.max_drawdown_all, 1, false)}.
        </p>
      </div>
    </div>
  );
}
