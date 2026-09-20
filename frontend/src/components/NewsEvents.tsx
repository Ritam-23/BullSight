"use client";
import { BarChart3, CalendarClock, Coins, ExternalLink, Newspaper, PlayCircle, Scissors } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type NewsData } from "@/lib/api";
import { compact, money, pct } from "@/lib/format";
import Loader from "./Loader";

function ago(iso: string | null) {
  if (!iso) return "";
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 30) return `${Math.round(mins / 1440)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

const EVENT_ICON = { earnings: BarChart3, ex_dividend: Scissors, dividend: Coins };

export default function NewsEvents({ symbol }: { symbol: string }) {
  const [data, setData] = useState<NewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRelated, setShowRelated] = useState(false);

  useEffect(() => {
    api<NewsData>(`/news/${encodeURIComponent(symbol)}`).then(setData).catch((e) => setError(e.message));
  }, [symbol]);

  if (error) return <p className="text-sm text-down">{error}</p>;
  if (!data) return <div className="flex h-48 items-center justify-center"><Loader label="Fetching news & events…" /></div>;

  const cur = data.currency;
  const direct = data.news.filter((n) => n.relevance === "direct");
  const related = data.news.filter((n) => n.relevance === "related");
  const list = showRelated ? data.news : direct.length ? direct : data.news;
  const upcoming = data.upcoming.filter((e) => (e.days_away ?? -1) >= 0);
  const recent = data.upcoming.filter((e) => (e.days_away ?? -1) < 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Newspaper size={16} className="text-accent" aria-hidden /> Latest news</h3>
          {related.length > 0 && direct.length > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={showRelated} onChange={(e) => setShowRelated(e.target.checked)} className="accent-[var(--accent)]" />
              Include {related.length} related
            </label>
          )}
        </div>
        {list.length === 0 && <p className="py-8 text-center text-sm text-muted">No recent news for this stock.</p>}
        <ul className="stagger space-y-1">
          {list.map((n, i) => (
            <li key={`${n.url}-${i}`}>
              <a href={n.url ?? undefined} target="_blank" rel="noopener noreferrer"
                className="group -mx-2 flex gap-3 rounded-xl p-2 transition-colors hover:bg-surface-2">
                {n.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.thumbnail} alt="" loading="lazy" className="h-16 w-24 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><Newspaper size={20} aria-hidden /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium group-hover:text-accent-ink">
                    {n.type === "video" && <PlayCircle size={13} className="mr-1 inline -translate-y-px text-muted" aria-label="Video" />}
                    {n.title}
                  </span>
                  {n.summary && <span className="mt-0.5 line-clamp-1 block text-xs text-ink-2">{n.summary}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {n.publisher && <span>{n.publisher}</span>}
                    <span>{ago(n.published)}</span>
                    {n.relevance === "related" && <span className="rounded bg-surface-2 px-1.5 py-0.5">Related, may be about another company</span>}
                    <ExternalLink size={11} aria-hidden className="opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Headlines via Yahoo Finance; links open the publisher&apos;s site.</p>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarClock size={16} className="text-accent" aria-hidden /> Events</h3>
          {upcoming.length === 0 && recent.length === 0 && <p className="text-sm text-muted">No scheduled events.</p>}
          <ul className="space-y-2">
            {[...upcoming, ...recent].map((e, i) => {
              const Icon = EVENT_ICON[e.type];
              return (
              <li key={i} className={`flex items-start gap-3 rounded-xl border border-line p-3 ${(e.days_away ?? -1) < 0 ? "opacity-70" : ""}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Icon size={15} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{e.title}</span>
                    <span className={`num shrink-0 text-xs font-medium ${(e.days_away ?? -1) >= 0 ? "text-accent-ink" : "text-muted"}`}>
                      {e.days_away == null ? "" : e.days_away === 0 ? "Today" : e.days_away > 0 ? `in ${e.days_away} days` : `${-e.days_away} days ago`}
                    </span>
                  </span>
                  <span className="block text-xs text-ink-2">{fmtDate(e.date)}</span>
                  {e.type === "earnings" && e.detail.eps_estimate != null && (
                    <span className="num mt-1 block text-xs text-muted">
                      EPS estimate {money(e.detail.eps_estimate, cur)}
                      {e.detail.eps_low != null && e.detail.eps_high != null && ` (range ${money(e.detail.eps_low, cur)} – ${money(e.detail.eps_high, cur)})`}
                      {e.detail.revenue_estimate != null && ` · revenue est. ${compact(e.detail.revenue_estimate, cur)}`}
                    </span>
                  )}
                </span>
              </li>
              );
            })}
          </ul>
        </div>

        {data.earnings.some((e) => e.eps_reported != null) && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Earnings history</h3>
            <table className="num w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-1.5 font-medium">Date</th><th className="py-1.5 text-right font-medium">Estimate</th>
                <th className="py-1.5 text-right font-medium">Reported</th><th className="py-1.5 text-right font-medium">Surprise</th>
              </tr></thead>
              <tbody>
                {data.earnings.filter((e) => e.eps_reported != null).slice(0, 6).map((e) => (
                  <tr key={e.date} className="border-b border-line last:border-0">
                    <td className="py-1.5 text-ink-2">{e.date}</td>
                    <td className="py-1.5 text-right">{money(e.eps_estimate, cur)}</td>
                    <td className="py-1.5 text-right font-medium">{money(e.eps_reported, cur)}</td>
                    <td className={`py-1.5 text-right font-medium ${e.surprise_pct == null ? "text-muted" : e.surprise_pct >= 0 ? "text-up" : "text-down"}`}>
                      {e.surprise_pct == null ? "—" : `${e.surprise_pct >= 0 ? "Beat " : "Missed "}${pct(Math.abs(e.surprise_pct), 1, false)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(data.dividends.length > 0 || data.splits.length > 0) && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Dividends</h3>
              {data.dividends.length === 0 ? <p className="text-xs text-muted">None</p> : (
                <ul className="num space-y-1 text-xs">
                  {data.dividends.slice(0, 6).map((d) => (
                    <li key={d.date} className="flex justify-between"><span className="text-ink-2">{d.date}</span><span>{money(d.value, cur)}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Splits</h3>
              {data.splits.length === 0 ? <p className="text-xs text-muted">None</p> : (
                <ul className="num space-y-1 text-xs">
                  {data.splits.slice(0, 6).map((d) => (
                    <li key={d.date} className="flex justify-between"><span className="text-ink-2">{d.date}</span><span>{d.value >= 1 ? `${d.value}:1` : `1:${(1 / d.value).toFixed(0)}`}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
