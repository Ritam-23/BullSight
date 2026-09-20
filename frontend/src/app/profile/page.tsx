"use client";
import { Briefcase, CheckCircle2, Info, Plus, Star, Trash2, Wallet, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import AddMoneyModal from "@/components/AddMoneyModal";
import AvatarUploader from "@/components/AvatarUploader";
import Change from "@/components/Change";
import Loader from "@/components/Loader";
import Logo from "@/components/Logo";
import NavBar from "@/components/NavBar";
import TradeModal from "@/components/TradeModal";
import { api, post, type Portfolio, type WatchItem } from "@/lib/api";
import { money, pct } from "@/lib/format";

const TABS = ["holdings", "watchlist", "orders", "wallet"] as const;
type Tab = (typeof TABS)[number];
const SLOTS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-7"];
const PROVIDER = { google: "Google", github: "GitHub", password: "Email & password", demo: "Demo account" } as Record<string, string>;
const TX_LABEL: Record<string, string> = { topup: "Added via Stripe", demo_credit: "Virtual funds added", buy: "Bought", sell: "Sold" };

const when = (t: number) => new Date(t * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Signed({ v, className = "" }: { v: number | null | undefined; className?: string }) {
  if (v == null) return <span className="text-muted">—</span>;
  return <span className={`num ${v > 0 ? "text-up" : v < 0 ? "text-down" : "text-ink-2"} ${className}`}>{v > 0 ? "+" : ""}{money(v, "INR")}</span>;
}

function Stat({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between text-xs text-muted">{label}{action}</div>
      <div className="mt-1 text-xl font-semibold">{children}</div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}

function Profile() {
  const params = useSearchParams();
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [watch, setWatch] = useState<WatchItem[] | null>(null);
  const [tab, setTab] = useState<Tab>("holdings");
  const [adding, setAdding] = useState(params.get("add") === "1");
  const [trade, setTrade] = useState<{ symbol: string; side: "buy" | "sell"; held: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topup, setTopup] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api<Portfolio>("/portfolio").then(setPf).catch((e) => setError(e.message));
    api<WatchItem[]>("/watchlist").then(setWatch).catch(() => setWatch([]));
  }, []);
  useEffect(load, [load]);

  // Returning from Stripe Checkout: confirm with the server (which re-checks the session with Stripe).
  useEffect(() => {
    const status = params.get("topup");
    const sessionId = params.get("session_id");
    if (!status) return;
    window.history.replaceState(null, "", "/profile");
    if (status === "cancelled") {
      setTimeout(() => setTopup({ ok: false, text: "Payment cancelled. No money was added." }));
      return;
    }
    if (status === "success" && sessionId) {
      post<{ ok: boolean; amount_inr?: number; status?: string }>("/wallet/stripe/confirm", { session_id: sessionId })
        .then((r) => {
          setTopup(r.ok
            ? { ok: true, text: `${money(r.amount_inr ?? 0, "INR")} added to your wallet.` }
            : { ok: false, text: `Payment not completed yet (status: ${r.status}). It will be credited once Stripe confirms it.` });
          load();
        })
        .catch((e) => setTopup({ ok: false, text: (e as Error).message }));
    }
  }, [params, load]);

  async function unwatch(symbol: string) {
    setWatch((w) => w?.filter((x) => x.symbol !== symbol) ?? null);
    await api(`/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" }).catch(load);
  }

  const s = pf?.summary;
  const totalValue = pf?.holdings.reduce((a, h) => a + h.value_inr, 0) ?? 0;
  const alloc = [...(pf?.holdings ?? [])].sort((a, b) => b.value_inr - a.value_inr);
  const top = alloc.slice(0, 5);
  const other = alloc.slice(5).reduce((a, h) => a + h.value_inr, 0);

  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {error && <p role="alert" className="text-sm text-down">{error}</p>}
        {!pf && !error && <div className="flex h-80 items-center justify-center"><Loader size="lg" label="Loading your portfolio…" /></div>}

        {pf && s && (
          <div className="animate-fade-up">
            <header className="flex flex-wrap items-center gap-4">
              <AvatarUploader
                name={pf.user.name}
                avatar={pf.user.avatar}
                size={56}
                onChange={(user) => setPf((prev) => (prev ? { ...prev, user } : prev))}
              />
              <div>
                <h1 className="text-2xl font-semibold">{pf.user.name}</h1>
                <p className="text-sm text-ink-2">{pf.user.email ?? "No email"} · {PROVIDER[pf.user.provider] ?? pf.user.provider}</p>
              </div>
              <p className="ml-auto flex max-w-sm items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
                <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                Paper trading: orders fill at live market prices, but no real shares are bought or sold.
              </p>
            </header>

            {topup && (
              <p role="status" className={`mt-4 flex animate-fade-in items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm ${topup.ok ? "text-up" : "text-down"}`}>
                {topup.ok ? <CheckCircle2 size={16} aria-hidden /> : <XCircle size={16} aria-hidden />} {topup.text}
                <button onClick={() => setTopup(null)} className="ml-auto text-xs text-muted hover:text-ink">Dismiss</button>
              </p>
            )}

            <section className="stagger mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Net worth"><span className="num">{money(s.net_worth_inr, "INR")}</span></Stat>
              <Stat
                label="Wallet balance"
                action={
                  <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white hover:opacity-90">
                    <Plus size={12} aria-hidden /> Add money
                  </button>
                }
              >
                <span className="num">{money(pf.wallet.balance_inr, "INR")}</span>
              </Stat>
              <Stat label="Invested · current value">
                <span className="num text-base">{money(s.invested_inr, "INR")} → {money(s.current_inr, "INR")}</span>
              </Stat>
              <Stat label="Total P&L · today">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Signed v={s.pnl_inr} />
                  {s.pnl_pct != null && <Change value={s.pnl_pct} className="text-sm" />}
                </div>
                <div className="text-xs font-normal text-muted">Today <Signed v={s.day_pnl_inr} /> · Realised <Signed v={s.realized_pnl_inr} /></div>
              </Stat>
            </section>

            {alloc.length > 0 && totalValue > 0 && (
              <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
                <div className="mb-2 text-xs text-muted">Allocation</div>
                <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                  {top.map((h, i) => <div key={h.symbol} style={{ width: `${(h.value_inr / totalValue) * 100}%`, background: `var(${SLOTS[i]})` }} />)}
                  {other > 0 && <div style={{ width: `${(other / totalValue) * 100}%`, background: "var(--axis)" }} />}
                </div>
                <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  {top.map((h, i) => (
                    <span key={h.symbol} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: `var(${SLOTS[i]})` }} />{h.symbol} {pct((h.value_inr / totalValue) * 100, 1, false)}
                    </span>
                  ))}
                  {other > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "var(--axis)" }} />Other {pct((other / totalValue) * 100, 1, false)}</span>}
                </div>
              </section>
            )}

            <div className="mt-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
              {TABS.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                  {t === "holdings" ? `Holdings (${pf.holdings.length})` : t === "watchlist" ? `Watchlist (${watch?.length ?? "…"})` : t === "orders" ? "Orders" : "Wallet history"}
                </button>
              ))}
            </div>

            <section key={tab} className="animate-fade-in overflow-x-auto">
              {tab === "holdings" && (pf.holdings.length === 0 ? (
                <Empty icon={<Briefcase size={28} />} text="No holdings yet." cta={<Link href="/" className="text-accent-ink hover:underline">Find a stock to buy</Link>} />
              ) : (
                <table className="num w-full min-w-[860px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Stock</th><th className="py-2 pr-3 text-right font-medium">Qty</th>
                    <th className="py-2 pr-3 text-right font-medium">Avg price</th><th className="py-2 pr-3 text-right font-medium">LTP</th>
                    <th className="py-2 pr-3 text-right font-medium">Invested</th><th className="py-2 pr-3 text-right font-medium">Current</th>
                    <th className="py-2 pr-3 text-right font-medium">P&amp;L</th><th className="py-2 pr-3 text-right font-medium">Today</th><th />
                  </tr></thead>
                  <tbody>
                    {pf.holdings.map((h) => (
                      <tr key={h.symbol} className="border-b border-line last:border-0">
                        <td className="max-w-[260px] py-3 pr-3">
                          <div className="flex items-center gap-2.5">
                            <Logo symbol={h.symbol} name={h.name} size={32} />
                            <div className="min-w-0">
                              <Link href={`/stock/${encodeURIComponent(h.symbol)}`} className="font-semibold hover:text-accent-ink">{h.symbol}</Link>
                              <div className="truncate text-xs text-ink-2">{h.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-right">{h.qty}</td>
                        <td className="py-3 pr-3 text-right">{money(h.avg_price, h.currency)}</td>
                        <td className="py-3 pr-3 text-right">{money(h.price, h.currency)}<div><Change value={h.change_pct} className="text-xs" /></div></td>
                        <td className="py-3 pr-3 text-right">{money(h.invested_inr, "INR")}</td>
                        <td className="py-3 pr-3 text-right">{money(h.value_inr, "INR")}</td>
                        <td className="py-3 pr-3 text-right"><Signed v={h.pnl_inr} /><div><Change value={h.pnl_pct} className="text-xs" /></div></td>
                        <td className="py-3 pr-3 text-right"><Signed v={h.day_pnl_inr} /></td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => setTrade({ symbol: h.symbol, side: "buy", held: h.qty })} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "var(--candle-up)" }}>Buy</button>
                            <button onClick={() => setTrade({ symbol: h.symbol, side: "sell", held: h.qty })} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "var(--candle-down)" }}>Sell</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}

              {tab === "watchlist" && (!watch ? <div className="py-10"><Loader /></div> : watch.length === 0 ? (
                <Empty icon={<Star size={28} />} text="Your watchlist is empty." cta={<span className="text-ink-2">Tap &quot;Add to watchlist&quot; on any stock page.</span>} />
              ) : (
                <table className="num w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Stock</th><th className="py-2 pr-3 text-right font-medium">Price</th>
                    <th className="py-2 pr-3 text-right font-medium">Change</th><th />
                  </tr></thead>
                  <tbody>
                    {watch.map((w) => {
                      const held = pf.holdings.find((h) => h.symbol === w.symbol)?.qty ?? 0;
                      return (
                        <tr key={w.symbol} className="border-b border-line last:border-0">
                          <td className="max-w-[300px] py-3 pr-3">
                            <div className="flex items-center gap-2.5">
                              <Logo symbol={w.symbol} name={w.name} size={32} />
                              <div className="min-w-0">
                                <Link href={`/stock/${encodeURIComponent(w.symbol)}`} className="font-semibold hover:text-accent-ink">{w.symbol}</Link>
                                <div className="truncate text-xs text-ink-2">{w.name}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-right">{money(w.price, w.currency)}</td>
                          <td className="py-3 pr-3 text-right"><Change value={w.change_pct} /></td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              {!w.symbol.startsWith("^") && !w.symbol.includes("=") && (
                                <button onClick={() => setTrade({ symbol: w.symbol, side: "buy", held })} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "var(--candle-up)" }}>Buy</button>
                              )}
                              <button onClick={() => unwatch(w.symbol)} aria-label={`Remove ${w.symbol} from watchlist`} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-down"><Trash2 size={15} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}

              {tab === "orders" && (pf.orders.length === 0 ? <Empty icon={<Briefcase size={28} />} text="No orders yet." /> : (
                <table className="num w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Time</th><th className="py-2 pr-3 font-medium">Stock</th><th className="py-2 pr-3 font-medium">Side</th>
                    <th className="py-2 pr-3 text-right font-medium">Qty</th><th className="py-2 pr-3 text-right font-medium">Price</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th><th className="py-2 text-right font-medium">Realised P&amp;L</th>
                  </tr></thead>
                  <tbody>
                    {pf.orders.map((o, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="py-2.5 pr-3 text-ink-2">{when(o.at)}</td>
                        <td className="py-2.5 pr-3 font-medium">{o.symbol}</td>
                        <td className="py-2.5 pr-3"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${o.side === "buy" ? "text-up" : "text-down"}`} style={{ background: "var(--surface-2)" }}>{o.side}</span></td>
                        <td className="py-2.5 pr-3 text-right">{o.qty}</td>
                        <td className="py-2.5 pr-3 text-right">{money(o.price, o.currency)}</td>
                        <td className="py-2.5 pr-3 text-right">{money(o.amount_inr, "INR")}</td>
                        <td className="py-2.5 text-right">{o.realized_pnl_inr == null ? <span className="text-muted">—</span> : <Signed v={o.realized_pnl_inr} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}

              {tab === "wallet" && (pf.transactions.length === 0 ? (
                <Empty icon={<Wallet size={28} />} text="No wallet activity yet." cta={<button onClick={() => setAdding(true)} className="text-accent-ink hover:underline">Add money</button>} />
              ) : (
                <table className="num w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Time</th><th className="py-2 pr-3 font-medium">Activity</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th><th className="py-2 text-right font-medium">Balance</th>
                  </tr></thead>
                  <tbody>
                    {pf.transactions.map((t, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="py-2.5 pr-3 text-ink-2">{when(t.at)}</td>
                        <td className="py-2.5 pr-3">{TX_LABEL[t.kind] ?? t.kind}{t.ref && <span className="text-xs text-muted"> · {t.ref}</span>}</td>
                        <td className="py-2.5 pr-3 text-right"><Signed v={t.amount_inr} /></td>
                        <td className="py-2.5 text-right">{money(t.balance_inr, "INR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </section>
          </div>
        )}

        {adding && <AddMoneyModal onClose={() => setAdding(false)} onAdded={load} />}
        {trade && pf && (
          <TradeModal symbol={trade.symbol} initialSide={trade.side} heldQty={trade.held} balance={pf.wallet.balance_inr}
            onClose={() => setTrade(null)} onDone={load} />
        )}
      </main>
    </>
  );
}

function Empty({ icon, text, cta }: { icon: React.ReactNode; text: string; cta?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted">
      <span className="text-axis">{icon}</span>
      <p>{text}</p>
      {cta}
    </div>
  );
}
