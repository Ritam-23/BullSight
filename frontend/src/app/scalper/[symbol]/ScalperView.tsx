"use client";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  LineSeries,
  LineStyle,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ExternalLink, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Change from "@/components/Change";
import Loader from "@/components/Loader";
import Logo from "@/components/Logo";
import NavBar from "@/components/NavBar";
import SearchBox from "@/components/SearchBox";
import { api, post, type ScalpData, type SeriesPoint } from "@/lib/api";
import { compact, money } from "@/lib/format";
import { cssVar, useIsDark } from "@/lib/theme";
import { supertrendLine } from "@/components/CandleChart";

const INTERVALS = ["1m", "2m", "5m"] as const;
const REFRESH_MS = 15_000;
const KIND_LABEL = { ema: "EMA", vwap: "VWAP", supertrend: "ST" } as const;

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const line = (pts: SeriesPoint[]) => pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));


type Series = {
  candles: ISeriesApi<"Candlestick">; vol: ISeriesApi<"Histogram">; ema9: ISeriesApi<"Line">; ema21: ISeriesApi<"Line">;
  vwap: ISeriesApi<"Line">; st: ISeriesApi<"Line">; rsi: ISeriesApi<"Line">;
  markers: ISeriesMarkersPluginApi<Time>; levels: IPriceLine[];
};

export default function ScalperView({ symbol }: { symbol: string }) {
  const [interval, setIntervalName] = useState<(typeof INTERVALS)[number]>("1m");
  const [data, setData] = useState<ScalpData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [qty, setQty] = useState(1);
  const [position, setPosition] = useState<{ held_qty: number; balance_inr: number } | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Series | null>(null);
  const fittedRef = useRef(false);
  const dark = useIsDark();
  const tradeable = !symbol.startsWith("^") && !symbol.includes("=");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api<ScalpData>(`/scalp/${encodeURIComponent(symbol)}?interval=${interval}`));
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [symbol, interval]);

  const loadPosition = useCallback(() => {
    api<{ held_qty: number; balance_inr: number }>(`/watchlist/${encodeURIComponent(symbol)}`).then(setPosition).catch(() => {});
  }, [symbol]);

  // Initial load, then auto-refresh while the market is open.
  useEffect(() => {
    fittedRef.current = false;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (!data?.market_open) return;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [data?.market_open, load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(loadPosition, [loadPosition]);

  // Build the chart once per symbol/interval/theme; data refreshes only call setData (keeps zoom).
  useEffect(() => {
    const el = box.current;
    if (!el || dark === null) return;
    const c = cssVar;
    const up = c("--candle-up"), down = c("--candle-down");
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c("--surface") }, textColor: c("--muted"), fontSize: 11,
        fontFamily: getComputedStyle(document.body).fontFamily, attributionLogo: false,
        panes: { separatorColor: c("--grid"), separatorHoverColor: c("--surface-2") },
      },
      grid: { vertLines: { color: c("--grid") }, horzLines: { color: c("--grid") } },
      rightPriceScale: { borderColor: c("--axis") },
      timeScale: { borderColor: c("--axis"), timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { timeFormatter: (t: Time) => clock(t as number) },
    });
    const thin = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
    const candles = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, ...thin });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const s: Series = {
      candles, vol,
      ema9: chart.addSeries(LineSeries, { color: c("--series-1"), lineWidth: 1, ...thin }),
      ema21: chart.addSeries(LineSeries, { color: c("--series-2"), lineWidth: 1, ...thin }),
      vwap: chart.addSeries(LineSeries, { color: c("--series-7"), lineWidth: 2, lineStyle: LineStyle.Dashed, ...thin }),
      st: chart.addSeries(LineSeries, { color: up, lineWidth: 2, ...thin }),
      rsi: chart.addSeries(LineSeries, { color: c("--series-7"), lineWidth: 2, priceLineVisible: false, title: "RSI 7" }, 1),
      markers: createSeriesMarkers(candles, []),
      levels: [],
    };
    for (const p of [70, 30]) s.rsi.createPriceLine({ price: p, color: c("--axis"), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
    chart.panes()[0]?.setStretchFactor(4);
    chart.panes()[1]?.setStretchFactor(1);
    chartRef.current = chart;
    seriesRef.current = s;
    fittedRef.current = false;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol, interval, dark]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !data || data.interval !== interval) return;
    const up = cssVar("--candle-up"), down = cssVar("--candle-down");
    s.candles.setData(data.candles.map((k) => ({ ...k, time: k.time as UTCTimestamp })));
    s.vol.setData(data.candles.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: `${k.close >= k.open ? up : down}55` })));
    s.ema9.setData(line(data.ema9));
    s.ema21.setData(line(data.ema21));
    s.vwap.setData(line(data.vwap));
    s.st.setData(supertrendLine(data.st_up, data.st_down, up, down));
    s.rsi.setData(line(data.rsi7));
    s.markers.setMarkers(data.signals.map((g) => ({
      time: g.time as UTCTimestamp, position: g.side === "buy" ? "belowBar" as const : "aboveBar" as const,
      // Only Supertrend flips (rarer, bigger signal) get a text label; the rest stay as arrows to avoid clutter.
      shape: g.side === "buy" ? "arrowUp" as const : "arrowDown" as const, color: g.side === "buy" ? up : down,
      text: g.kind === "supertrend" ? KIND_LABEL[g.kind] : undefined, size: g.kind === "supertrend" ? 1 : 0.6,
    })));
    for (const l of s.levels) s.candles.removePriceLine(l);
    s.levels = data.levels ? [
      s.candles.createPriceLine({ price: data.levels.stop, color: down, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: "Stop" }),
      s.candles.createPriceLine({ price: data.levels.target, color: up, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: "Target" }),
    ] : [];
    if (!fittedRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [data, interval]);

  async function trade(side: "buy" | "sell") {
    setBusy(true);
    setToast(null);
    try {
      const r = await post<{ qty: number; price: number; currency: string; amount_inr: number; realized_pnl_inr: number | null }>("/trade", { symbol, side, qty });
      setToast({ ok: true, text: `${side === "buy" ? "Bought" : "Sold"} ${r.qty} @ ${money(r.price, r.currency)}${r.realized_pnl_inr != null ? ` · P&L ${r.realized_pnl_inr >= 0 ? "+" : ""}${money(r.realized_pnl_inr, "INR")}` : ""}` });
      loadPosition();
    } catch (e) {
      setToast({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const st = data?.stats;
  const cur = data ? (data.symbol.endsWith(".NS") || data.symbol.endsWith(".BO") ? "INR" : "USD") : null;
  const biasTone = data?.bias.label.startsWith("Long") ? "text-up" : data?.bias.label.startsWith("Short") ? "text-down" : "text-ink-2";
  const secs = updatedAt ? Math.round((now - updatedAt) / 1000) : null;

  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        <div className="relative z-30 flex flex-wrap items-center gap-3">
          <div className="w-full max-w-sm"><SearchBox compact basePath="/scalper" /></div>
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Candle interval">
            {INTERVALS.map((i) => (
              <button key={i} onClick={() => setIntervalName(i)} aria-pressed={interval === i}
                className={`rounded-md px-3 py-1 text-xs font-medium ${interval === i ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>{i}</button>
            ))}
          </div>
          {data && (
            <span className="flex items-center gap-2 text-xs text-ink-2">
              <span className="relative flex h-2 w-2">
                {data.market_open && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "var(--candle-up)" }} />}
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: data.market_open ? "var(--candle-up)" : "var(--axis)" }} />
              </span>
              {data.market_open ? <>Live · refreshes every 15s · updated {secs}s ago</> : <>Market closed · showing session of {data.session_date}</>}
            </span>
          )}
          <button onClick={load} disabled={refreshing} aria-label="Refresh" className="ml-auto rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>

        {data && st && (
          <header className="mt-4 flex flex-wrap items-end justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <Logo symbol={data.symbol} size={44} />
              <div>
                <div className="text-sm text-ink-2">Scalper · {data.interval} candles{data.source !== data.symbol && ` · via ${data.source}`}</div>
                <h1 className="text-2xl font-semibold">{data.symbol}</h1>
              </div>
            </div>
            <div className="text-right">
              <div className="num text-3xl font-semibold">{money(st.last, cur)}</div>
              <Change value={st.change_pct} className="text-sm" />
            </div>
          </header>
        )}

        {error && <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-down"><AlertTriangle size={16} /> {error}</p>}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-ink-2">
              {[["--series-1", "EMA 9"], ["--series-2", "EMA 21"], ["--series-7", "VWAP"], ["--candle-up", "Supertrend"]].map(([v, l]) => (
                <span key={l} className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 rounded" style={{ background: `var(${v})` }} />{l}</span>
              ))}
              <span className="flex items-center gap-1"><ArrowUpRight size={12} className="text-up" aria-hidden />/<ArrowDownRight size={12} className="text-down" aria-hidden /> signals: EMA cross, VWAP cross, ST flip</span>
            </div>
            <div className="relative h-[520px]">
              <div ref={box} className="absolute inset-0" />
              {!data && !error && <div className="absolute inset-0 flex items-center justify-center bg-surface"><Loader label="Loading intraday candles…" /></div>}
            </div>
          </section>

          <aside className="space-y-4">
            {data && st && (
              <>
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <div className="text-xs text-muted">Indicator bias</div>
                  <div className={`mt-0.5 text-xl font-semibold ${biasTone}`}>{data.bias.label}</div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {data.bias.checks.map((c) => (
                      <li key={c.name} className="flex items-center justify-between">
                        <span className="text-ink-2">{c.name}</span>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${c.bullish ? "text-up" : "text-down"}`}>
                          {c.bullish ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}{c.bullish ? "Bullish" : "Bearish"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {data.levels && (
                    <div className="num mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center text-xs">
                      <div><div className="text-muted">Entry</div><div className="font-medium">{money(data.levels.entry, cur)}</div></div>
                      <div><div className="text-muted">Stop (1×ATR)</div><div className="font-medium text-down">{money(data.levels.stop, cur)}</div></div>
                      <div><div className="text-muted">Target (1.5×)</div><div className="font-medium text-up">{money(data.levels.target, cur)}</div></div>
                    </div>
                  )}
                </div>

                {tradeable && (
                  <div className="rounded-2xl border border-line bg-surface p-4">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted">
                      <span>Quick paper trade</span>
                      {position && <span className="num">Held {position.held_qty} · wallet {money(position.balance_inr, "INR", 0)}</span>}
                    </div>
                    <div className="flex gap-1.5">
                      {[1, 5, 10, 25, 100].map((n) => (
                        <button key={n} onClick={() => setQty(n)} aria-pressed={qty === n}
                          className={`num flex-1 rounded-lg border py-1 text-xs ${qty === n ? "border-accent text-accent-ink" : "border-line text-ink-2"}`}>{n}</button>
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button onClick={() => trade("buy")} disabled={busy} className="h-10 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--candle-up)" }}>Buy {qty}</button>
                      <button onClick={() => trade("sell")} disabled={busy || !position?.held_qty} className="h-10 rounded-xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: "var(--candle-down)" }}>Sell {qty}</button>
                    </div>
                    {toast && <p role="status" className={`mt-2 text-xs ${toast.ok ? "text-up" : "text-down"}`}>{toast.text}</p>}
                    {position && position.balance_inr === 0 && (
                      <Link href="/profile?add=1" className="mt-2 block text-xs text-accent-ink hover:underline">Add money to your wallet</Link>
                    )}
                  </div>
                )}

                <div className="num grid grid-cols-3 gap-2 rounded-2xl border border-line bg-surface p-4 text-xs">
                  {[
                    ["Open", money(st.open, cur)], ["High", money(st.high, cur)], ["Low", money(st.low, cur)],
                    ["VWAP", money(st.vwap, cur)], ["ATR", st.atr != null ? money(st.atr, cur) : "—"], ["RSI 7", st.rsi7?.toFixed(1) ?? "—"],
                    ["Prev close", money(st.prev_close, cur)], ["Volume", compact(st.volume)],
                  ].map(([k, v]) => (
                    <div key={k}><div className="text-muted">{k}</div><div className="font-medium">{v}</div></div>
                  ))}
                </div>

                <div className="rounded-2xl border border-line bg-surface p-4">
                  <div className="mb-2 text-xs text-muted">Signal log ({data.signals.length})</div>
                  <ul className="max-h-64 space-y-1 overflow-auto text-xs">
                    {[...data.signals].reverse().map((g, i) => (
                      <li key={`${g.time}-${g.kind}-${i}`} className="flex items-center gap-2">
                        <span className="num w-16 shrink-0 text-muted">{clock(g.time)}</span>
                        {g.side === "buy" ? <ArrowUpRight size={13} className="shrink-0 text-up" aria-label="Buy signal" /> : <ArrowDownRight size={13} className="shrink-0 text-down" aria-label="Sell signal" />}
                        <span className="min-w-0 flex-1 truncate text-ink-2">{g.label}</span>
                        <span className="num shrink-0">{money(g.price, cur)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </aside>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 text-xs text-muted">
          <p className="max-w-3xl">
            Signals are mechanical indicator crossovers, and stop/target lines are 1× and 1.5× ATR examples, not recommendations. Scalping is high risk:
            SEBI found about 7 in 10 individual intraday traders in India lost money in FY2022-23. Yahoo intraday data can lag by a minute or more.
          </p>
          <Link href={`/stock/${encodeURIComponent(symbol)}`} className="inline-flex items-center gap-1 text-accent-ink hover:underline">
            Full analysis <ExternalLink size={12} aria-hidden />
          </Link>
        </div>
      </main>
    </>
  );
}
