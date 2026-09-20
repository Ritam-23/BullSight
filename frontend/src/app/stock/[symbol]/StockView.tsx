"use client";
import { AlertCircle, CheckCircle2, CircleSlash, Info, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import Change from "@/components/Change";
import Disclaimer from "@/components/Disclaimer";
import NavBar from "@/components/NavBar";
import { api, type Forecast, type StockInfo } from "@/lib/api";
import { compact, money, num, pct, priceCurrency } from "@/lib/format";
import AnalyticsPanel from "@/components/AnalyticsPanel";
import Loader from "@/components/Loader";
import Logo from "@/components/Logo";
import NewsEvents from "@/components/NewsEvents";
import StockActions from "@/components/StockActions";
import CandleChart from "@/components/CandleChart";
import AccuracyExplainer from "./AccuracyExplainer";
import ForecastChart from "./ForecastChart";

function Stat({ label, value }: { label: string; value: string }) {
  if (value === "—" || value.startsWith("— ")) return null;
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

const ratio = (v: unknown) => (typeof v === "number" ? pct(v * 100, 1, false) : "—");

export default function StockView({ symbol }: { symbol: string }) {
  const [info, setInfo] = useState<StockInfo | null>(null);
  const [fc, setFc] = useState<Forecast | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [fcErr, setFcErr] = useState<string | null>(null);

  // The page remounts this component per symbol (key), so state starts fresh.
  useEffect(() => {
    const s = encodeURIComponent(symbol);
    api<StockInfo>(`/stock/${s}`).then(setInfo).catch((e) => setInfoErr(e.message));
    api<Forecast>(`/predict/${s}`).then(setFc).catch((e) => setFcErr(e.message));
  }, [symbol]);

  const cur = info ? priceCurrency(symbol, info.currency) : null;
  const f = info?.fundamentals ?? {};
  const proxied = info && info.data_source !== info.symbol;

  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {infoErr && (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-down" role="alert">
            <AlertCircle size={18} /> {infoErr}
          </div>
        )}

        {!info && !infoErr && (
          <div className="space-y-3">
            <div className="skeleton h-20 rounded-2xl" />
            <div className="skeleton h-[420px] rounded-2xl" />
          </div>
        )}

        {info && (
          <header className="flex animate-fade-up flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-4">
            <Logo symbol={info.symbol} name={info.name} size={56} />
            <div>
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <span className="font-semibold text-ink">{info.symbol}</span>
                {info.exchange && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{info.exchange === "INDEX" ? "Index" : info.exchange === "COMMODITY" ? "Commodity" : info.exchange}</span>}
                {info.type === "ETF" && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">ETF</span>}
                {f.sector && <span className="text-muted">{String(f.sector)}</span>}
              </div>
              <h1 className="mt-1 text-2xl font-semibold">{info.name}</h1>
            </div>
            </div>
            <div className="text-right">
              <div className="num text-3xl font-semibold">{money(info.price, cur)}</div>
              <div className="flex items-center justify-end gap-2 text-sm">
                <span className="num text-ink-2">{info.change > 0 ? "+" : ""}{money(info.change, cur)}</span>
                <Change value={info.change_pct} />
              </div>
              <div className="text-xs text-muted">Close as of {info.as_of}</div>
            </div>
          </header>
        )}
        {info && <StockActions symbol={symbol} tradeable={info.type === "EQUITY" || info.type === "ETF"} />}

        {proxied && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
            Yahoo Finance&apos;s BSE feed for this stock is incomplete, so prices and forecasts use its NSE listing ({info?.data_source}). BSE and NSE prices normally differ by a few paise.
          </p>
        )}

        {info && (
          <section className="mt-6 animate-fade-up rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <CandleChart symbol={symbol} currency={cur} forecast={fc} />
          </section>
        )}

        {info && info.type !== "INDEX" && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <h2 className="mb-4 font-semibold">News &amp; events</h2>
            <NewsEvents symbol={symbol} />
          </section>
        )}

        {info && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <h2 className="mb-4 font-semibold">Analytics</h2>
            <AnalyticsPanel symbol={symbol} currency={cur} />
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Price forecast</h2>
            {fc && (
              <span className="text-sm text-ink-2">
                20-day outlook: <b className="text-ink">{fc.outlook}</b>
              </span>
            )}
          </div>
          {!fc && !fcErr && (
            <div className="flex h-80 items-center justify-center">
              <Loader label="Training models and running the walk-forward backtest…" />
            </div>
          )}
          {fcErr && (
            <p className="flex items-center gap-2 text-sm text-down" role="alert">
              <AlertCircle size={16} /> {fcErr}
            </p>
          )}
          {fc && <div className="animate-fade-in"><ForecastChart data={fc} currency={cur} /></div>}
        </section>

        {fc && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <h2 className="font-semibold">Forecasts and how they tested</h2>
            <p className="mt-1 text-sm text-ink-2">
              Each forecast was checked against the ~{fc.horizons[0].backtest.test_days} most recent trading days it had not seen during training.
              A forecast only has value if it beats the baseline in the same row.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="num w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Horizon</th>
                    <th className="py-2 pr-3 font-medium">Forecast</th>
                    <th className="py-2 pr-3 font-medium">80% range</th>
                    <th className="py-2 pr-3 font-medium">Direction right</th>
                    <th className="py-2 pr-3 font-medium">Price accuracy<br />model / no-change</th>
                    <th className="py-2 pr-3 font-medium">Error vs no-change</th>
                    <th className="py-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {fc.horizons.map((h) => {
                    const b = h.backtest;
                    const naive = h.model === "naive";
                    return (
                      <tr key={h.days} className="border-b border-line last:border-0">
                        <td className="py-3 pr-3">
                          <div className="font-medium">{h.days} day{h.days > 1 ? "s" : ""}</div>
                          <div className="text-xs text-muted">{h.date}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="font-medium text-forecast">{money(h.predicted_price, cur)}</div>
                          <Change value={h.change_pct} className="text-xs" />
                        </td>
                        <td className="py-3 pr-3 text-ink-2">
                          {money(h.low, cur)} – {money(h.high, cur)}
                        </td>
                        <td className="py-3 pr-3">
                          {b.directional_accuracy == null ? (
                            <span className="text-muted">n/a</span>
                          ) : (
                            <>
                              {b.directional_accuracy}%
                              <div className="text-xs text-muted">baseline {b.always_up_accuracy}%</div>
                            </>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          {b.price_accuracy}% / {b.naive_price_accuracy}%
                        </td>
                        <td className="py-3 pr-3">{naive ? <span className="text-muted">—</span> : `${Math.abs(b.skill_vs_naive).toFixed(1)}% ${b.skill_vs_naive > 0 ? "lower" : "higher"}`}</td>
                        <td className="py-3">
                          {naive ? (
                            <span className="inline-flex items-center gap-1 text-muted"><CircleSlash size={14} aria-hidden /> No edge found</span>
                          ) : b.skill_vs_naive >= 1 ? (
                            <span className="inline-flex items-center gap-1 text-up"><CheckCircle2 size={14} aria-hidden /> Beat baseline</span>
                          ) : b.skill_vs_naive > -1 ? (
                            <span className="inline-flex items-center gap-1 text-ink-2"><Minus size={14} aria-hidden /> Same as baseline</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-down"><AlertCircle size={14} aria-hidden /> Worse than baseline</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="mt-4 text-sm text-ink-2">
              <summary className="cursor-pointer text-accent-ink">How to read this</summary>
              <div className="mt-2 space-y-2">
                <p>
                  <b>Price accuracy</b> is 100% minus the average percentage error. It is always high for stock prices, because prices rarely move
                  more than a few percent in a day. Simply guessing &quot;no change&quot; also scores about 95–99%, so compare the two numbers.
                </p>
                <p>
                  <b>Direction right</b> is how often the model called up vs down correctly. The baseline is always guessing the more common
                  direction in that period. <b>No edge found</b> means no model beat &quot;no change&quot; on the validation year, so the forecast is
                  flat instead of guessing.
                </p>
                <p className="text-muted">{fc.method}</p>
              </div>
            </details>
          </section>
        )}

        {fc && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <AccuracyExplainer fc={fc} currency={cur} />
          </section>
        )}

        {info && info.type !== "INDEX" && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <h2 className="mb-4 font-semibold">Key statistics</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="Market cap" value={compact(f.market_cap as number, cur)} />
              <Stat label="P/E (trailing)" value={num(f.pe as number)} />
              <Stat label="P/E (forward)" value={num(f.forward_pe as number)} />
              <Stat label="Price / book" value={num(f.pb as number)} />
              <Stat label="Profit margin" value={ratio(f.profit_margin)} />
              <Stat label="Return on equity" value={ratio(f.roe)} />
              <Stat label="Revenue growth" value={ratio(f.revenue_growth)} />
              <Stat label="Earnings growth" value={ratio(f.earnings_growth)} />
              <Stat label="Dividend yield" value={typeof f.dividend_yield === "number" ? pct(f.dividend_yield, 2, false) : "—"} />
              <Stat label="Beta" value={num(f.beta as number)} />
              <Stat label="52-week range" value={`${money(f.low_52w as number, cur, 0)} – ${money(f.high_52w as number, cur, 0)}`} />
              <Stat label="Volume" value={compact(info.volume)} />
            </div>
            {typeof f.analyst_target === "number" && (
              <p className="mt-3 text-sm text-ink-2">
                Analyst consensus: <b className="text-ink">{String(f.analyst_rating ?? "—").replace("_", " ")}</b>, mean target {money(f.analyst_target, cur)} ({String(f.analyst_count ?? "?")} analysts).
              </p>
            )}
            {f.summary && <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-ink-2">{String(f.summary)}</p>}
          </section>
        )}

        <div className="mt-8">
          <Disclaimer />
        </div>
      </main>
    </>
  );
}
