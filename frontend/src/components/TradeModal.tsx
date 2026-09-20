"use client";
import { CheckCircle2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, post, type Quote } from "@/lib/api";
import { money } from "@/lib/format";
import Change from "./Change";
import Loader from "./Loader";
import Logo from "./Logo";
import Modal from "./Modal";

type Result = { side: string; qty: number; price: number; currency: string; amount_inr: number; balance_inr: number; realized_pnl_inr: number | null };

export default function TradeModal({
  symbol, initialSide, heldQty, balance, onClose, onDone,
}: {
  symbol: string; initialSide: "buy" | "sell"; heldQty: number; balance: number;
  onClose: () => void; onDone: () => void;
}) {
  const [side, setSide] = useState(initialSide);
  const [qty, setQty] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);

  useEffect(() => {
    api<Quote>(`/quote/${encodeURIComponent(symbol)}`).then(setQuote).catch((e) => setError(e.message));
  }, [symbol]);

  const total = quote ? quote.price_inr * qty : 0;
  const buying = side === "buy";
  const short = buying ? total > balance : qty > heldQty;
  const maxBuy = quote ? Math.floor(balance / quote.price_inr) : 0;

  async function place() {
    setBusy(true);
    setError(null);
    try {
      setDone(await post<Result>("/trade", { symbol, side, qty }));
      onDone();
      // Email the receipt PDF for this trade (buy or sell). Fire-and-forget: the /receipt
      // route lives outside the /api proxy and derives everything from the session cookie, so
      // a failure here never blocks the order confirmation.
      fetch("/receipt", { method: "POST", credentials: "same-origin" }).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={done ? "Order placed" : `${buying ? "Buy" : "Sell"} ${symbol}`} onClose={onClose}>
      {done ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 size={40} className="mx-auto text-up" aria-hidden />
          <p className="num text-sm text-ink-2">
            {done.side === "buy" ? "Bought" : "Sold"} <b className="text-ink">{done.qty}</b> × {symbol} at{" "}
            <b className="text-ink">{money(done.price, done.currency)}</b> for <b className="text-ink">{money(done.amount_inr, "INR")}</b>.
          </p>
          {done.realized_pnl_inr != null && (
            <p className={`num text-sm font-medium ${done.realized_pnl_inr >= 0 ? "text-up" : "text-down"}`}>
              Realised P&amp;L: {done.realized_pnl_inr >= 0 ? "+" : ""}{money(done.realized_pnl_inr, "INR")}
            </p>
          )}
          <p className="num text-xs text-muted">Wallet balance: {money(done.balance_inr, "INR")}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-10 flex-1 rounded-xl border border-line text-sm font-medium hover:bg-surface-2">Close</button>
            <Link href="/profile" className="flex h-10 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-medium text-white">View portfolio</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 rounded-xl bg-surface-2 p-1">
            {(["buy", "sell"] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)} aria-pressed={side === s}
                className={`rounded-lg py-2 text-sm font-medium transition-all ${side === s ? (s === "buy" ? "bg-[var(--candle-up)] text-white" : "bg-[var(--candle-down)] text-white") : "text-muted"}`}>
                {s === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>

          {!quote && !error && <div className="py-6"><Loader label="Fetching live price…" /></div>}
          {quote && (
            <>
              <div className="flex items-center justify-between gap-3">
                <Logo symbol={symbol} name={quote.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink-2">{quote.name}</div>
                  <div className="text-xs text-muted">Market price {quote.source !== symbol && `(via ${quote.source})`}</div>
                </div>
                <div className="text-right">
                  <div className="num text-xl font-semibold">{money(quote.price, quote.currency)}</div>
                  <Change value={quote.change_pct} className="text-xs" />
                </div>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-ink-2">Quantity</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line hover:bg-surface-2"><Minus size={16} /></button>
                  <input
                    inputMode="numeric"
                    aria-label="Quantity"
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, Math.min(100000, Number(e.target.value.replace(/\D/g, "")) || 1)))}
                    className="num h-11 flex-1 rounded-xl border border-line bg-page text-center text-lg font-semibold outline-none focus:border-accent"
                  />
                  <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line hover:bg-surface-2"><Plus size={16} /></button>
                </div>
                <div className="num mt-1 flex justify-between text-xs text-muted">
                  <span>{buying ? `Max affordable: ${maxBuy}` : `You hold: ${heldQty}`}</span>
                  {!buying && heldQty > 0 && <button className="text-accent-ink hover:underline" onClick={() => setQty(heldQty)}>Sell all</button>}
                </div>
              </div>

              <div className="num space-y-1 rounded-xl bg-surface-2 p-3 text-sm">
                {quote.currency !== "INR" && (
                  <div className="flex justify-between text-xs text-muted">
                    <span>{qty} × {money(quote.price, quote.currency)} @ ₹{quote.fx.toFixed(2)}/USD</span>
                  </div>
                )}
                <div className="flex justify-between"><span className="text-ink-2">{buying ? "Estimated cost" : "Estimated proceeds"}</span><b>{money(total, "INR")}</b></div>
                <div className="flex justify-between text-xs text-muted"><span>Wallet balance</span><span>{money(balance, "INR")}</span></div>
              </div>

              {short && (
                <p className="text-sm text-down">
                  {buying ? <>Not enough balance. <Link href="/profile?add=1" className="underline">Add money</Link></> : `You only hold ${heldQty} shares.`}
                </p>
              )}
              {error && <p role="alert" className="text-sm text-down">{error}</p>}

              <button
                onClick={place}
                disabled={busy || short}
                className="flex h-11 w-full items-center justify-center rounded-xl font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: buying ? "var(--candle-up)" : "var(--candle-down)" }}
              >
                {busy ? <Loader size="sm" /> : `${buying ? "Buy" : "Sell"} ${qty} share${qty > 1 ? "s" : ""}`}
              </button>
              <p className="text-center text-xs text-muted">Paper trade at the live market price. No real shares are bought or sold.</p>
            </>
          )}
          {!quote && error && <p role="alert" className="text-sm text-down">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
