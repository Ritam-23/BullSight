"use client";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Forecast } from "@/lib/api";
import { money } from "@/lib/format";

type Point = { t: number; close?: number; forecast?: number; band?: [number, number]; days?: number };

const DAY = 86_400_000;
const HISTORY_DAYS = 90; // enough context without squeezing the 20-day projection into a sliver
const ts = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function ForecastChart({ data, currency }: { data: Forecast; currency: string | null }) {
  const history = data.history.slice(-HISTORY_DAYS);
  const last = history[history.length - 1];
  const today = ts(last.date);
  const points: Point[] = history.map((h) => ({ t: ts(h.date), close: h.close }));
  // Bridge point so the projection and its band start from the last real close.
  points[points.length - 1] = { ...points[points.length - 1], forecast: last.close, band: [last.close, last.close], days: 0 };
  for (const h of data.horizons) {
    points.push({ t: ts(h.date), forecast: h.predicted_price, band: [h.low, h.high], days: h.days });
  }
  const end = data.horizons[data.horizons.length - 1];
  const allNaive = data.horizons.every((h) => h.model === "naive");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--series-1)" }} /> Close
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: "var(--forecast)" }} /> Projected price
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-sm" style={{ background: "var(--forecast)", opacity: 0.18 }} /> 80% range from backtest errors
        </span>
        <span className="num ml-auto font-medium text-forecast">
          {end.days}-day target {money(end.predicted_price, currency)} ({end.change_pct > 0 ? "+" : ""}{end.change_pct.toFixed(2)}%)
        </span>
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 24, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", `dataMax + ${2 * DAY}`]}
              tickFormatter={fmtDate}
              stroke="var(--axis)"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={["auto", "auto"]}
              stroke="var(--axis)"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(v: number) => money(v, null, v >= 1000 ? 0 : 2)}
            />
            <ReferenceLine
              x={today}
              stroke="var(--axis)"
              strokeDasharray="3 3"
              label={{ value: "Today", position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Point;
                const future = p.close == null;
                return (
                  <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
                    <div className="mb-1 text-muted">{fmtDate(p.t)}{future && p.days ? ` · ${p.days} trading day${p.days > 1 ? "s" : ""} ahead` : ""}</div>
                    {p.close != null && <div>Close <b>{money(p.close, currency)}</b></div>}
                    {future && p.forecast != null && (
                      <>
                        <div className="font-medium text-forecast">Projected <b>{money(p.forecast, currency)}</b></div>
                        {p.band && <div className="text-ink-2">80% range {money(p.band[0], currency)} – {money(p.band[1], currency)}</div>}
                      </>
                    )}
                  </div>
                );
              }}
            />
            <Area dataKey="band" stroke="none" fill="var(--forecast)" fillOpacity={0.16} isAnimationActive={false} connectNulls />
            <Line dataKey="close" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              dataKey="forecast"
              stroke="var(--forecast)"
              strokeWidth={2.5}
              strokeDasharray="6 4"
              dot={{ r: 4, fill: "var(--forecast)", stroke: "var(--surface)", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: "var(--forecast)", stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls
            />
            <ReferenceDot
              x={ts(end.date)}
              y={end.predicted_price}
              r={0}
              label={{ value: money(end.predicted_price, currency), position: "top", fill: "var(--forecast)", fontSize: 12, fontWeight: 600 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {allNaive && (
        <p className="mt-2 text-xs text-muted">
          The projection is flat: no model beat the &quot;price stays the same&quot; guess in validation for this stock, so the app projects today&apos;s
          price rather than guess a direction. The shaded range still shows how far it typically moves.
        </p>
      )}
    </div>
  );
}
