"use client";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  LineSeries,
  LineStyle,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { AlertCircle, CandlestickChart, ChartArea, ChartLine, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Candle, type ChartData, type Forecast, type SeriesPoint } from "@/lib/api";
import { compact, money } from "@/lib/format";
import { cssVar, useIsDark } from "@/lib/theme";
import Change from "./Change";
import Loader from "./Loader";

const RANGES = ["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y", "MAX"] as const;
type Range = (typeof RANGES)[number];
type Kind = "candle" | "line" | "area";

// Overlays draw on the price pane; colors are fixed per indicator so nothing repaints when others toggle.
const OVERLAYS = [
  { id: "sma20", label: "SMA 20", color: "--series-1", desc: "20-bar simple moving average" },
  { id: "sma50", label: "SMA 50", color: "--series-2", desc: "50-bar simple moving average" },
  { id: "sma200", label: "SMA 200", color: "--series-4", desc: "Long-term trend line" },
  { id: "ema20", label: "EMA 20", color: "--series-3", desc: "Faster, exponentially weighted average" },
  { id: "bb", label: "Bollinger Bands", color: "--series-5", desc: "20-bar average ± 2 standard deviations" },
  { id: "supertrend", label: "Supertrend", color: "--candle-up", desc: "ATR trailing stop; green below price = uptrend" },
  { id: "psar", label: "Parabolic SAR", color: "--ink-2", desc: "Trailing dots that flip when the trend reverses" },
  { id: "ichimoku", label: "Ichimoku Cloud", color: "--series-7", desc: "Tenkan, Kijun and the 26-bar forward cloud" },
  { id: "vwap", label: "VWAP", color: "--series-7", desc: "Volume-weighted average price (intraday)", intradayOnly: true },
] as const;
type OverlayId = (typeof OVERLAYS)[number]["id"];

const PANES = [
  { id: "volume", label: "Volume", desc: "Shares traded per bar (on the price pane)" },
  { id: "rsi", label: "RSI (14)", desc: "Momentum 0–100; 70 overbought, 30 oversold" },
  { id: "macd", label: "MACD (12, 26, 9)", desc: "Trend momentum: MACD vs signal line" },
  { id: "stoch", label: "Stochastic (14, 3)", desc: "Close vs recent range; 80 / 20 levels" },
  { id: "adx", label: "ADX / DMI (14)", desc: "Trend strength (ADX > 25 strong) and direction" },
  { id: "atr", label: "ATR (14)", desc: "Average true range: volatility per bar" },
  { id: "obv", label: "On-Balance Volume", desc: "Cumulative volume flow; rising = accumulation" },
  { id: "cci", label: "CCI (20)", desc: "Deviation from average; ±100 extremes" },
  { id: "willr", label: "Williams %R (14)", desc: "−20 overbought, −80 oversold" },
] as const;
type PaneId = (typeof PANES)[number]["id"];

const dayTs = (d: string) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000);

type FcPoint = { time: number; price: number; low: number; high: number; days: number };

/** Projected path: today's close, then each forecast horizon (1, 5, 10, 20 trading days). */
function projection(fc: Forecast, anchor: number): FcPoint[] {
  return [
    { time: anchor, price: fc.last_close, low: fc.last_close, high: fc.last_close, days: 0 },
    ...fc.horizons
      .map((h) => ({ time: dayTs(h.date), price: h.predicted_price, low: h.low, high: h.high, days: h.days }))
      .filter((p) => p.time > anchor),
  ];
}

const toLine = (pts: SeriesPoint[] = []) => pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));

/** Supertrend as one line colored per point (green in uptrends, red in downtrends), like TradingView. */
export function supertrendLine(upPts: SeriesPoint[] = [], downPts: SeriesPoint[] = [], up: string, down: string) {
  return [...upPts.map((p) => ({ ...p, color: up })), ...downPts.map((p) => ({ ...p, color: down }))]
    .sort((a, b) => a.time - b.time)
    .map((p) => ({ time: p.time as UTCTimestamp, value: p.value, color: p.color }));
}

function fmtTime(t: number, intraday: boolean) {
  return new Date(t * 1000).toLocaleString("en-US", {
    timeZone: "UTC",
    ...(intraday ? { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }),
  });
}

export default function CandleChart({ symbol, currency, forecast }: { symbol: string; currency: string | null; forecast?: Forecast | null }) {
  const [range, setRange] = useState<Range>("6M");
  const [kind, setKind] = useState<Kind>("candle");
  const [overlays, setOverlays] = useState<Set<OverlayId>>(new Set(["sma50"]));
  const [panes, setPanes] = useState<Set<PaneId>>(new Set(["volume"]));
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedRange, setLoadedRange] = useState<Range | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [hoverFc, setHoverFc] = useState<FcPoint | null>(null);
  const [showForecast, setShowForecast] = useState(true);
  const [picker, setPicker] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dark = useIsDark();
  const loading = loadedRange !== range;

  useEffect(() => {
    let cancelled = false;
    api<ChartData>(`/chart/${encodeURIComponent(symbol)}?range=${range}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoadedRange(range));
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  useEffect(() => {
    const el = box.current;
    if (!el || !data || dark === null || data.candles.length === 0) return;
    const c = (v: string) => cssVar(v);
    const up = c("--candle-up");
    const down = c("--candle-down");
    const ind = data.indicators;

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c("--surface") },
        textColor: c("--muted"),
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: c("--grid"), separatorHoverColor: c("--surface-2") },
      },
      grid: { vertLines: { color: c("--grid") }, horzLines: { color: c("--grid") } },
      rightPriceScale: { borderColor: c("--axis") },
      timeScale: { borderColor: c("--axis"), timeVisible: data.intraday, secondsVisible: false, rightOffset: 3 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: (p: number) => (Math.abs(p) >= 1e6 ? compact(p) : money(p, null, Math.abs(p) >= 1000 ? 0 : 2)),
        timeFormatter: (t: Time) => fmtTime(t as number, data.intraday),
      },
    });

    const candles = data.candles.map((k) => ({ ...k, time: k.time as UTCTimestamp }));
    let main: ISeriesApi<SeriesType>;
    if (kind === "candle") {
      main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
      main.setData(candles);
    } else {
      const rising = data.candles[data.candles.length - 1].close >= data.candles[0].open;
      const line = rising ? up : down;
      main = kind === "area"
        ? chart.addSeries(AreaSeries, { lineColor: line, topColor: `${line}40`, bottomColor: `${line}00`, lineWidth: 2 })
        : chart.addSeries(LineSeries, { color: line, lineWidth: 2 });
      main.setData(candles.map((k) => ({ time: k.time, value: k.close })));
    }

    type LineOpts = { style?: LineStyle; width?: 1 | 2 | 3; title?: string; last?: boolean };
    const addLine = (pts: SeriesPoint[] | undefined, color: string, pane = 0, o: LineOpts = {}) => {
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: o.width ?? 1, lineStyle: o.style ?? LineStyle.Solid, priceLineVisible: false,
        lastValueVisible: o.last ?? false, crosshairMarkerVisible: false, title: o.title ?? "",
      }, pane);
      s.setData(toLine(pts));
      return s;
    };
    const levels = (s: ISeriesApi<"Line">, values: number[]) => {
      for (const price of values) s.createPriceLine({ price, color: c("--axis"), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
    };

    // ---- overlays on the price pane
    if (overlays.has("sma20")) addLine(ind.sma20, c("--series-1"));
    if (overlays.has("sma50")) addLine(ind.sma50, c("--series-2"));
    if (overlays.has("sma200")) addLine(ind.sma200, c("--series-4"));
    if (overlays.has("ema20")) addLine(ind.ema20, c("--series-3"));
    if (overlays.has("bb")) {
      addLine(ind.bb_upper, c("--series-5"));
      addLine(ind.bb_mid, c("--series-5"), 0, { style: LineStyle.Dashed });
      addLine(ind.bb_lower, c("--series-5"));
    }
    if (overlays.has("supertrend")) {
      chart.addSeries(LineSeries, { color: up, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        .setData(supertrendLine(ind.st_up, ind.st_down, up, down));
    }
    if (overlays.has("psar")) {
      const s = chart.addSeries(LineSeries, {
        color: c("--ink-2"), lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(toLine(ind.psar));
    }
    if (overlays.has("ichimoku")) {
      addLine(ind.ichi_tenkan, c("--series-7"));
      addLine(ind.ichi_kijun, c("--series-7"), 0, { style: LineStyle.Dashed });
      addLine(ind.ichi_span_a, `${up}aa`, 0, { style: LineStyle.Dotted });
      addLine(ind.ichi_span_b, `${down}aa`, 0, { style: LineStyle.Dotted });
    }
    if (overlays.has("vwap") && data.intraday) addLine(ind.vwap, c("--series-7"), 0, { width: 2 });

    if (panes.has("volume")) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(candles.map((k) => ({ time: k.time, value: k.volume, color: `${k.close >= k.open ? up : down}66` })));
    }

    // ---- lower panels, in a fixed order
    let pane = 1;
    const next = () => pane++;
    if (panes.has("rsi")) {
      const p = next();
      levels(addLine(ind.rsi14, c("--series-7"), p, { width: 2, title: "RSI", last: true }), [70, 30]);
    }
    if (panes.has("macd")) {
      const p = next();
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, p);
      hist.setData((ind.macd_hist ?? []).map((q) => ({ time: q.time as UTCTimestamp, value: q.value, color: `${q.value >= 0 ? up : down}99` })));
      addLine(ind.macd, c("--series-1"), p, { width: 2, title: "MACD", last: true });
      addLine(ind.macd_signal, c("--series-2"), p, { width: 2, title: "Signal", last: true });
    }
    if (panes.has("stoch")) {
      const p = next();
      levels(addLine(ind.stoch_k, c("--series-1"), p, { width: 2, title: "%K", last: true }), [80, 20]);
      addLine(ind.stoch_d, c("--series-2"), p, { width: 2, title: "%D", last: true });
    }
    if (panes.has("adx")) {
      const p = next();
      levels(addLine(ind.adx, c("--series-7"), p, { width: 2, title: "ADX", last: true }), [25]);
      addLine(ind.plus_di, up, p, { title: "+DI", last: true });
      addLine(ind.minus_di, down, p, { title: "−DI", last: true });
    }
    if (panes.has("atr")) addLine(ind.atr, c("--series-1"), next(), { width: 2, title: "ATR", last: true });
    if (panes.has("obv")) addLine(ind.obv, c("--series-1"), next(), { width: 2, title: "OBV", last: true });
    if (panes.has("cci")) levels(addLine(ind.cci, c("--series-1"), next(), { width: 2, title: "CCI", last: true }), [100, -100]);
    if (panes.has("willr")) levels(addLine(ind.willr, c("--series-1"), next(), { width: 2, title: "%R", last: true }), [-20, -80]);

    // ---- forecast projection (daily/weekly views only)
    const fcPoints = forecast && !data.intraday && showForecast ? projection(forecast, candles[candles.length - 1].time) : [];
    if (fcPoints.length > 1) {
      const fcColor = c("--forecast");
      const band = { color: `${fcColor}99`, lineWidth: 1 as const, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      chart.addSeries(LineSeries, band).setData(fcPoints.map((p) => ({ time: p.time as UTCTimestamp, value: p.high })));
      chart.addSeries(LineSeries, band).setData(fcPoints.map((p) => ({ time: p.time as UTCTimestamp, value: p.low })));
      const path = chart.addSeries(LineSeries, {
        color: fcColor, lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: true, priceLineVisible: true,
        priceLineColor: fcColor, priceLineStyle: LineStyle.Dotted, title: `${fcPoints[fcPoints.length - 1].days}D target`,
      });
      path.setData(fcPoints.map((p) => ({ time: p.time as UTCTimestamp, value: p.price })));
      createSeriesMarkers(path, fcPoints.slice(1).map((p) => ({
        time: p.time as UTCTimestamp, position: "inBar" as const, shape: "circle" as const, color: fcColor, size: 0.6,
      })));
    }

    const allPanes = chart.panes();
    allPanes[0]?.setStretchFactor(3);
    for (const p of allPanes.slice(1)) p.setStretchFactor(1);

    chart.timeScale().fitContent();
    const byTime = new Map(data.candles.map((k) => [k.time, k]));
    const fcByTime = new Map(fcPoints.slice(1).map((p) => [p.time, p]));
    const onMove = (p: MouseEventParams) => {
      setHover(p.time ? byTime.get(p.time as number) ?? null : null);
      setHoverFc(p.time ? fcByTime.get(p.time as number) ?? null : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [data, kind, overlays, panes, dark, forecast, showForecast]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  };

  const s = data?.summary;
  const shown = hover ?? data?.candles[data.candles.length - 1];
  const extraPanes = [...panes].filter((p) => p !== "volume").length;
  const activeCount = overlays.size + panes.size;
  const pill = (on: boolean) => `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${on ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`;
  const endFc = forecast?.horizons[forecast.horizons.length - 1];
  const visibleOverlays = OVERLAYS.filter((o) => !("intradayOnly" in o) || data?.intraday);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {s && (
          <>
            <Change value={s.change_pct} className="text-sm" />
            <span className="text-xs text-muted">
              {range === "1D" ? "today" : `over ${range}`} · range {money(s.low, currency)} – {money(s.high, currency)}
            </span>
          </>
        )}
        {endFc && !data?.intraday && showForecast && !hoverFc && (
          <span className="num text-xs font-medium text-forecast">
            Projected {endFc.days}D: {money(endFc.predicted_price, currency)} ({endFc.change_pct > 0 ? "+" : ""}{endFc.change_pct.toFixed(2)}%)
          </span>
        )}
        {hoverFc ? (
          <span className="num ml-auto text-xs font-medium text-forecast">
            Forecast {fmtTime(hoverFc.time, false)} ({hoverFc.days}D) · {money(hoverFc.price, currency)} · 80% range {money(hoverFc.low, currency)} – {money(hoverFc.high, currency)}
          </span>
        ) : shown && (
          <span className="num ml-auto text-xs text-ink-2">
            {fmtTime(shown.time, !!data?.intraday)} · O {money(shown.open, null)} H {money(shown.high, null)} L {money(shown.low, null)} C{" "}
            <b className="text-ink">{money(shown.close, null)}</b> · Vol {compact(shown.volume)}
          </span>
        )}
      </div>

      <div className="relative w-full" style={{ height: 380 + extraPanes * 110 }}>
        <div ref={box} className="absolute inset-0" />
        {(loading || error || data?.candles.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70 text-sm text-ink-2">
            {loading ? <Loader label="Loading chart…" /> : (
              <span className="flex items-center gap-2 text-down"><AlertCircle size={16} /> {error ?? "No data for this range"}</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={pill(range === r)}>{r}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Chart type">
          {([["candle", CandlestickChart, "Candles"], ["line", ChartLine, "Line"], ["area", ChartArea, "Area"]] as const).map(([k, Icon, label]) => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} title={label} aria-label={label} className={pill(kind === k)}>
              <Icon size={14} />
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            onClick={() => setPicker((v) => !v)}
            aria-expanded={picker}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
          >
            <SlidersHorizontal size={14} aria-hidden /> Indicators
            <span className="num rounded bg-surface-2 px-1.5 text-[11px] text-ink-2">{activeCount}</span>
          </button>
          {picker && (
            <div className="absolute bottom-full left-0 z-30 mb-1 w-[min(92vw,560px)] animate-fade-in rounded-xl border border-line bg-surface p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Indicators</span>
                <button onClick={() => setPicker(false)} aria-label="Close" className="rounded p-1 text-muted hover:text-ink"><X size={15} /></button>
              </div>
              <div className="grid max-h-[60vh] gap-3 overflow-auto sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">On the price chart</div>
                  {visibleOverlays.map((o) => (
                    <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                      <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={overlays.has(o.id)} onChange={() => toggle(overlays, o.id, setOverlays)} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm">
                          <span className="inline-block h-0.5 w-3 rounded" style={{ background: `var(${o.color})` }} />{o.label}
                        </span>
                        <span className="block text-xs text-muted">{o.desc}</span>
                      </span>
                    </label>
                  ))}
                  {forecast && !data?.intraday && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                      <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={showForecast} onChange={() => setShowForecast((v) => !v)} />
                      <span>
                        <span className="flex items-center gap-1.5 text-sm">
                          <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: "var(--forecast)" }} />Forecast
                        </span>
                        <span className="block text-xs text-muted">Model&apos;s projected price and 80% range</span>
                      </span>
                    </label>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Separate panels</div>
                  {PANES.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                      <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={panes.has(p.id)} onChange={() => toggle(panes, p.id, setPanes)} />
                      <span>
                        <span className="block text-sm">{p.label}</span>
                        <span className="block text-xs text-muted">{p.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Active indicators as removable chips; they double as the chart's legend. */}
        <div className="flex flex-wrap gap-1.5">
          {visibleOverlays.filter((o) => overlays.has(o.id)).map((o) => (
            <button key={o.id} onClick={() => toggle(overlays, o.id, setOverlays)} title="Remove"
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: `var(${o.color})` }} />{o.label}<X size={11} className="text-muted" aria-hidden />
            </button>
          ))}
          {forecast && !data?.intraday && showForecast && (
            <button onClick={() => setShowForecast(false)} title="Remove"
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs">
              <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: "var(--forecast)" }} />Forecast<X size={11} className="text-muted" aria-hidden />
            </button>
          )}
          {PANES.filter((p) => panes.has(p.id)).map((p) => (
            <button key={p.id} onClick={() => toggle(panes, p.id, setPanes)} title="Remove"
              className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2">
              {p.label}<X size={11} className="text-muted" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
