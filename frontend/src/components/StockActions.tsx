"use client";
import { Star, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "@/lib/api";
import TradeModal from "./TradeModal";

type Status = { watched: boolean; held_qty: number; balance_inr: number };

export default function StockActions({ symbol, tradeable }: { symbol: string; tradeable: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [trade, setTrade] = useState<"buy" | "sell" | null>(null);
  const [sectors, setSectors] = useState<{ slug: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api<Status>(`/watchlist/${encodeURIComponent(symbol)}`).then(setStatus).catch(() => {});
  }, [symbol]);

  useEffect(() => {
    refresh();
    api<{ slug: string; name: string }[]>(`/sectors/for/${encodeURIComponent(symbol)}`).then(setSectors).catch(() => {});
  }, [refresh, symbol]);

  async function toggleWatch() {
    if (!status) return;
    setBusy(true);
    const watched = !status.watched;
    setStatus({ ...status, watched }); // optimistic
    try {
      if (watched) await post("/watchlist", { symbol });
      else await api(`/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" });
    } catch {
      setStatus({ ...status, watched: !watched });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        onClick={toggleWatch}
        disabled={!status || busy}
        aria-pressed={status?.watched ?? false}
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors ${status?.watched ? "border-[var(--series-4)] text-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
      >
        <Star size={15} aria-hidden fill={status?.watched ? "var(--series-4)" : "none"} stroke={status?.watched ? "var(--series-4)" : "currentColor"} />
        {status?.watched ? "In watchlist" : "Add to watchlist"}
      </button>
      {tradeable && (
        <>
          <button onClick={() => setTrade("buy")} disabled={!status}
            className="h-9 rounded-xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--candle-up)" }}>
            Buy
          </button>
          <button onClick={() => setTrade("sell")} disabled={!status || status.held_qty === 0}
            title={status?.held_qty === 0 ? "You don't hold this stock" : undefined}
            className="h-9 rounded-xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--candle-down)" }}>
            Sell
          </button>
          {status && status.held_qty > 0 && (
            <Link href="/profile" className="num text-xs text-ink-2 hover:underline">You hold {status.held_qty}</Link>
          )}
        </>
      )}
      <Link href={`/scalper/${encodeURIComponent(symbol)}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink-2 hover:bg-surface-2">
        <Zap size={15} aria-hidden /> Scalp
      </Link>
      {sectors.length > 0 && (
        <div className="ml-auto flex flex-wrap gap-1.5">
          {sectors.slice(0, 4).map((s) => (
            <Link key={s.slug} href={`/sector/${s.slug}`} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2 hover:text-ink">
              {s.name}
            </Link>
          ))}
        </div>
      )}
      {trade && status && (
        <TradeModal
          symbol={symbol}
          initialSide={trade}
          heldQty={status.held_qty}
          balance={status.balance_inr}
          onClose={() => setTrade(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
