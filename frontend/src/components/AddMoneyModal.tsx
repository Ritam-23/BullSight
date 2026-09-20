"use client";
import { CreditCard, Info, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, post, type WalletConfig } from "@/lib/api";
import { money } from "@/lib/format";
import Loader from "./Loader";
import Modal from "./Modal";

const PRESETS = [1000, 5000, 10000, 50000];

export default function AddMoneyModal({ onClose, onAdded }: { onClose: () => void; onAdded: (balance: number) => void }) {
  const [cfg, setCfg] = useState<WalletConfig | null>(null);
  const [amount, setAmount] = useState("10000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<WalletConfig>("/wallet/config").then(setCfg).catch((e) => setError(e.message));
  }, []);

  const value = Number(amount);
  const valid = cfg && Number.isInteger(value) && value >= cfg.min && value <= cfg.max;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !cfg) return;
    setBusy(true);
    setError(null);
    try {
      if (cfg.mode === "test") {
        // Stripe hosts the payment page; it redirects back to /profile?topup=success&session_id=…
        const { url } = await post<{ url: string }>("/wallet/checkout", { amount: value });
        window.location.assign(url);
        return;
      }
      const res = await post<{ balance_inr: number }>("/wallet/demo-credit", { amount: value });
      onAdded(res.balance_inr);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Add money to wallet" onClose={onClose}>
      {!cfg && !error && <div className="py-8"><Loader /></div>}
      {cfg && (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">Amount (₹)</span>
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              className="num h-12 w-full rounded-xl border border-line bg-page px-3 text-lg font-semibold outline-none focus:border-accent"
              aria-describedby="amount-help"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button type="button" key={p} onClick={() => setAmount(String(p))}
                className={`num rounded-full border px-3 py-1 text-sm ${value === p ? "border-accent text-accent-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}>
                +{money(p, "INR", 0)}
              </button>
            ))}
          </div>
          <p id="amount-help" className="num text-xs text-muted">Between {money(cfg.min, "INR", 0)} and {money(cfg.max, "INR", 0)}.</p>

          {cfg.mode === "test" && (
            <p className="flex gap-2 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>
                You&apos;ll pay on Stripe&apos;s secure checkout page in <b>test mode</b>, so no real money moves. Use test card{" "}
                <b className="num">4242 4242 4242 4242</b>, any future expiry date and any CVC.
              </span>
            </p>
          )}
          {cfg.mode === "off" && (
            <p className="flex gap-2 rounded-lg bg-warn-bg p-3 text-xs text-warn">
              <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
              <span>Stripe isn&apos;t configured, so this adds <b>virtual funds</b> for paper trading. Add STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY (test keys) to backend/.env to pay through Stripe Checkout.</span>
            </p>
          )}
          {cfg.mode === "live-blocked" && (
            <p className="rounded-lg bg-warn-bg p-3 text-xs text-warn">
              Live Stripe keys are disabled: this wallet is for paper trading. Use sk_test_ keys.
            </p>
          )}

          {error && <p role="alert" className="text-sm text-down">{error}</p>}

          <button
            type="submit"
            disabled={!valid || busy || cfg.mode === "live-blocked"}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader size="sm" /> : cfg.mode === "test" ? (
              <><CreditCard size={16} aria-hidden /> Pay {money(value || 0, "INR", 0)} with Stripe</>
            ) : `Add ${money(value || 0, "INR", 0)} virtual funds`}
          </button>
        </form>
      )}
      {!cfg && error && <p className="text-sm text-down">{error}</p>}
    </Modal>
  );
}
