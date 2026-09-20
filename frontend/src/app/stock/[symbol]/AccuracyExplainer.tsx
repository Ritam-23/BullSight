"use client";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Forecast } from "@/lib/api";
import { money } from "@/lib/format";

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });

export default function AccuracyExplainer({ fc, currency }: { fc: Forecast; currency: string | null }) {
  const [hIdx, setHIdx] = useState(0);
  const h = fc.horizons[hIdx];
  const b = h.backtest;
  const series = b.series;
  const naive = h.model === "naive";
  // Most recent test where the price actually moved (a flat day makes "no change" look perfect).
  const ex = [...series].reverse().find((p) => p.actual !== p.base) ?? series[series.length - 1];
  const exErr = ex ? (Math.abs(ex.predicted - ex.actual) / ex.actual) * 100 : 0;
  const exNaiveErr = ex ? (Math.abs(ex.base - ex.actual) / ex.actual) * 100 : 0;
  const moved = series.filter((p) => p.actual !== p.base);
  const hits = moved.filter((p) => Math.sign(p.predicted - p.base) === Math.sign(p.actual - p.base)).length;
  const days = h.days === 1 ? "1 day" : `${h.days} days`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">What &quot;{b.price_accuracy}% accurate&quot; really means</h2>
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Forecast horizon">
          {fc.horizons.map((x, i) => (
            <button
              key={x.days}
              onClick={() => setHIdx(i)}
              aria-pressed={i === hIdx}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${i === hIdx ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
            >
              {x.days}D
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-surface-2 p-4">
          <div className="text-xs text-muted">Model price accuracy</div>
          <div className="num mt-1 text-2xl font-semibold">{b.price_accuracy}%</div>
          <div className="text-xs text-ink-2">off by {b.mape}% on average</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-4">
          <div className="text-xs text-muted">&quot;Price won&apos;t change&quot; guess</div>
          <div className="num mt-1 text-2xl font-semibold">{b.naive_price_accuracy}%</div>
          <div className="text-xs text-ink-2">off by {b.naive_mape}% on average</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-4">
          <div className="text-xs text-muted">Called up/down correctly</div>
          <div className="num mt-1 text-2xl font-semibold">{b.directional_accuracy == null ? "n/a" : `${b.directional_accuracy}%`}</div>
          <div className="text-xs text-ink-2">
            {b.directional_accuracy == null ? "flat forecast, no direction" : `${hits} of ${moved.length} tests · coin flip ≈ 50%, best fixed guess ${b.always_up_accuracy}%`}
          </div>
        </div>
      </div>

      {ex && (
        <div className="mt-4 rounded-xl border border-line p-4 text-sm leading-relaxed text-ink-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Worked example: a recent test</div>
          {days} before {fmtDate(ex.date)} the price was <b className="num text-ink">{money(ex.base, currency)}</b>. The model predicted{" "}
          <b className="num text-ink">{money(ex.predicted, currency)}</b>; the actual price turned out to be{" "}
          <b className="num text-ink">{money(ex.actual, currency)}</b>. That&apos;s an error of <b className="num text-ink">{exErr.toFixed(2)}%</b>, so this
          one forecast scores <b className="num text-ink">{(100 - exErr).toFixed(2)}%</b> &quot;accurate&quot;. Guessing no change would have been off by{" "}
          <b className="num text-ink">{exNaiveErr.toFixed(2)}%</b> ({(100 - exNaiveErr).toFixed(2)}% &quot;accurate&quot;). Averaging this over all {b.test_days} test
          days gives the {b.price_accuracy}% figure above.
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink-2">
          <span>Backtest, {days} ahead, on days the model never trained on:</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--series-1)" }} /> Actual price</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: "var(--series-2)" }} /> Model&apos;s forecast</span>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} minTickGap={50} />
              <YAxis domain={["auto", "auto"]} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={64}
                tickFormatter={(v: number) => money(v, null, v >= 1000 ? 0 : 2)} />
              <Tooltip
                cursor={{ stroke: "var(--axis)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as (typeof series)[number];
                  const err = (Math.abs(p.predicted - p.actual) / p.actual) * 100;
                  return (
                    <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
                      <div className="mb-1 text-muted">{fmtDate(p.date)}</div>
                      <div>Actual <b>{money(p.actual, currency)}</b></div>
                      <div>Forecast <b>{money(p.predicted, currency)}</b> ({err.toFixed(2)}% off)</div>
                      <div className="text-ink-2">Price when forecast was made {money(p.base, currency)}</div>
                    </div>
                  );
                }}
              />
              <Line dataKey="actual" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="predicted" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-xs text-muted">
          {naive
            ? "No model beat the no-change guess in validation, so the forecast is today's price. The dashed line is the actual line shifted forward."
            : "Notice the dashed line mostly trails the actual line by a few days. That's what a forecast anchored on today's price looks like, and why it scores ~99% without predicting moves."}
        </p>
      </div>

      <div className="mt-5 rounded-xl bg-surface-2 p-4 text-sm text-ink-2">
        <div className="mb-2 font-medium text-ink">How to judge any &quot;99% accurate&quot; stock prediction</div>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            <b className="text-ink">Ask what&apos;s being measured.</b> Price accuracy is almost always 95–99% because prices move a few percent at most in a day.
            It says nothing about whether you&apos;d make money.
          </li>
          <li>
            <b className="text-ink">Compare with &quot;no change&quot;.</b> A model is only useful if its error is clearly <i>lower</i> than just using today&apos;s price.
            Here that difference is {naive ? "zero (the model defers to it)" : `${Math.abs(b.skill_vs_naive).toFixed(1)}% ${b.skill_vs_naive > 0 ? "better" : "worse"}`}.
          </li>
          <li>
            <b className="text-ink">Look at direction.</b> Consistently calling up vs down 55–60% of the time over hundreds of days is already considered strong. 99% direction accuracy
            doesn&apos;t exist in liquid markets; if it did, the edge would be traded away quickly.
          </li>
          <li>
            <b className="text-ink">Check it was tested on unseen data.</b> Scores measured on data the model trained on are inflated. Every number on this page comes from
            days the model had not seen.
          </li>
        </ol>
      </div>
    </div>
  );
}
