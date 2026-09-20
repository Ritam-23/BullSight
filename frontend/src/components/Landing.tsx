"use client";
import { BarChart3, CandlestickChart, Check, Coins, Eye, EyeOff, LineChart, ShieldCheck, Target } from "lucide-react";
import { useEffect, useState } from "react";
import type { IndexQuote } from "@/lib/api";
import { money } from "@/lib/format";
import Change from "./Change";
import Loader from "./Loader";
import Sparkline from "./Sparkline";
import ThemeToggle from "./ThemeToggle";

type Providers = { providers: string[]; demo: boolean; password: boolean };
type Mode = "signin" | "register";

const FEATURES = [
  { Icon: CandlestickChart, title: "Candlestick charts & technicals", text: "Intraday to 20-year charts with SMA, EMA, Bollinger, VWAP, RSI and MACD." },
  { Icon: Target, title: "Forecasts with honest accuracy", text: "Every prediction is backtested on unseen data and compared with a no-change baseline." },
  { Icon: BarChart3, title: "Market movers & screener", text: "Top gainers, losers, most active and most profitable across NSE, BSE, NASDAQ and the S&P 500." },
  { Icon: Coins, title: "Gold & silver", text: "Futures plus every Indian and US gold and silver ETF, with the same analytics." },
];

const BRAND_NAME = "BullSight";

const WELCOME_PHRASE = `Welcome to ${BRAND_NAME}.`;

const TAGLINES = [
  "Analyze the Market.",
  "Predict the Future.",
  "Invest with Confidence.",
];

const WELCOME_TYPE_MS = 80;
const WELCOME_DELETE_MS = 45;
const WELCOME_HOLD_MS = 5500;
const WELCOME_START_MS = 1000;

function welcomeTypeDelay() {
  return WELCOME_TYPE_MS + Math.round(Math.random() * 45);
}

function welcomeDeleteDelay() {
  return WELCOME_DELETE_MS + Math.round(Math.random() * 30);
}

// Renders the phrase one letter at a time, each character fading in as it
// mounts so the typing reads as a smooth reveal rather than a hard pop.
// Characters within the "BullSight" span carry the brand font.
function renderBrandText(text: string) {
  const brandStart = WELCOME_PHRASE.indexOf(BRAND_NAME);
  const brandEnd = brandStart + BRAND_NAME.length;
  return Array.from(text).map((char, i) => {
    const inBrand = brandStart !== -1 && i >= brandStart && i < brandEnd;
    // Widen the gap between words so "Welcome to BullSight" breathes.
    if (char === " ") {
      return <span key={i} className="letter-in inline-block w-[0.5em]" aria-hidden />;
    }
    return (
      <span
        // Index-based key keeps a letter's identity stable as the string grows,
        // so already-typed letters don't re-animate on each new keystroke.
        key={i}
        className={`letter-in inline-block${inBrand ? " font-brand" : ""}`}
      >
        {char}
      </span>
    );
  });
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

const PASSWORD_RULES = [
  { label: "8+ characters", test: (p: string) => p.length >= 8 },
  { label: "Upper & lowercase", test: (p: string) => p.toLowerCase() !== p && p.toUpperCase() !== p },
  { label: "A number", test: (p: string) => /\d/.test(p) },
];

function AuthCard({ providers, onSuccess }: { providers: Providers | null; onSuccess: (msg: string) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // Deferred so the state update happens after mount, not synchronously in the effect body.
    const t = setTimeout(() => {
      if (q.get("mode") === "register") setMode("register");
      if (q.has("error")) setError("Sign-in was cancelled or failed. Please try again.");
    });
    return () => clearTimeout(t);
  }, []);

  const register = mode === "register";
  const rulesOk = PASSWORD_RULES.every((r) => r.test(password));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (register && !rulesOk) {
      setError("Please choose a stronger password.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(register ? { name, email, password } : { email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Something went wrong. Please try again.");
      onSuccess(register ? `Welcome, ${body.user?.name?.split(" ")[0] ?? "investor"}!` : "Signing you in…");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    const r = await fetch("/api/auth/demo", { method: "POST" });
    if (r.ok) onSuccess("Opening the demo…");
    else {
      setBusy(false);
      setError("Demo access is disabled.");
    }
  }

  const input = "h-11 w-full rounded-xl border border-line bg-page px-3 text-sm outline-none transition-colors focus:border-accent";
  const oauthBtn = "flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium transition-colors hover:bg-surface-2";

  return (
    <div className="w-full rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
      <div className="mb-6 grid grid-cols-2 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Account">
        {(["signin", "register"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded-lg py-2 text-sm font-medium transition-all ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <h2 className="text-xl font-semibold">{register ? "Create your account" : "Welcome back"}</h2>
      <p className="mt-1 text-sm text-ink-2">{register ? "Free, takes 20 seconds." : "Sign in to your markets dashboard."}</p>

      <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
        {register && (
          <label className="block animate-fade-in">
            <span className="mb-1 block text-xs font-medium text-ink-2">Full name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="Your name" />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Email</span>
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@example.com" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Password</span>
          <div className="relative">
            <input
              className={`${input} pr-10`}
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={register ? "new-password" : "current-password"}
              required
              placeholder={register ? "Create a password" : "Your password"}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        {register && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Password requirements">
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(password);
              return (
                <li key={r.label} className={`flex items-center gap-1 transition-colors ${ok ? "text-up" : "text-muted"}`}>
                  <Check size={12} aria-hidden className={ok ? "opacity-100" : "opacity-40"} /> {r.label}
                  <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p role="alert" className="animate-fade-in rounded-lg bg-surface-2 px-3 py-2 text-sm text-down">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader size="sm" /> : register ? "Create account" : "Sign in"}
        </button>
      </form>

      {/* Force show OAuth options for testing/setup */}
      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or continue with <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex gap-3">
        <a href="/api/auth/login/google" className={oauthBtn}><GoogleIcon /> Google</a>
      </div>

      {providers?.demo && (
        <p className="mt-5 text-center text-sm text-muted">
          Just looking?{" "}
          <button onClick={demo} disabled={busy} className="font-medium text-accent-ink hover:underline">Try the demo</button>
        </p>
      )}

      <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted">
        <ShieldCheck size={13} aria-hidden /> Passwords are salted and hashed with scrypt, never stored in plain text.
      </p>
    </div>
  );
}

export default function Landing() {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [markets, setMarkets] = useState<IndexQuote[] | null>(null);
  const [transition, setTransition] = useState<string | null>(null);
  const [welcomeText, setWelcomeText] = useState("");
  const [welcomeDeleting, setWelcomeDeleting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [taglineVisible, setTaglineVisible] = useState(false);

  // Types out "Welcome to BullSight.", holds, deletes, then hands off to the
  // taglines. Re-runs every time showWelcome flips back on, so the intro and
  // the taglines alternate forever.
  useEffect(() => {
    if (!showWelcome) return;

    let cancelled = false;
    let charIndex = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = (delay: number, fn: () => void) => {
      timer = setTimeout(fn, delay);
    };

    const tick = () => {
      if (cancelled) return;

      if (!deleting) {
        setWelcomeDeleting(false);
        setWelcomeText(WELCOME_PHRASE.slice(0, charIndex));
        if (charIndex < WELCOME_PHRASE.length) {
          charIndex++;
          schedule(welcomeTypeDelay(), tick);
          return;
        }
        schedule(WELCOME_HOLD_MS, () => {
          deleting = true;
          setWelcomeDeleting(true);
          tick();
        });
        return;
      }

      setWelcomeText(WELCOME_PHRASE.slice(0, charIndex));
      if (charIndex > 0) {
        charIndex--;
        schedule(welcomeDeleteDelay(), tick);
        return;
      }

      setWelcomeDeleting(false);
      setShowWelcome(false);
    };

    schedule(WELCOME_START_MS, tick);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showWelcome]);

  // Runs the taglines once through, then flips back to the welcome intro so the
  // whole sequence repeats.
  useEffect(() => {
    if (showWelcome) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let index = 0;

    const cycle = () => {
      if (cancelled) return;
      setTaglineIndex(index);
      setTaglineVisible(true);
      timer = setTimeout(() => {
        setTaglineVisible(false);
        timer = setTimeout(() => {
          index += 1;
          if (index >= TAGLINES.length) {
            // Seen every tagline — replay the welcome typewriter.
            setShowWelcome(true);
            return;
          }
          cycle();
        }, 600);
      }, 2800);
    };

    timer = setTimeout(cycle, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showWelcome]);

  useEffect(() => {
    fetch("/api/auth/providers").then((r) => r.json()).then(setProviders).catch(() => {});
    fetch("/api/public/markets").then((r) => r.json()).then(setMarkets).catch(() => setMarkets([]));
  }, []);

  function onSuccess(msg: string) {
    setTransition(msg);
    // Full reload so the server renders the signed-in dashboard; the overlay covers the gap.
    setTimeout(() => window.location.assign("/"), 650);
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      {transition && (
        <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-page">
          <div className="animate-fade-up">
            <Loader size="lg" label={transition} />
          </div>
        </div>
      )}

      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-10">
        <div className="flex items-center text-lg font-semibold">
          <span className="font-brand text-3xl">BullSight</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto grid w-full max-w-7xl py-[-10] flex-1 items-center px-4 pb-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <section className="animate-fade-up">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--candle-up)" }} /> NSE · BSE · NASDAQ · NYSE · Gold & Silver
          </p>
          <h1
            className={`text-4xl font-semibold leading-tight tracking-tight sm:text-5xl min-h-[120px] ${showWelcome ? `transition-opacity duration-[1400ms] ease-out ${welcomeDeleting ? "opacity-100" : "opacity-100"}` : ""}`}
          >
            {showWelcome ? (
              <>
                {renderBrandText(welcomeText)}
                <span className="typewriter-cursor ml-1 inline-block w-0.5 h-10 bg-accent align-middle" aria-hidden />
              </>
            ) : (
              <span className={`inline-block transition-opacity duration-700 ease-in-out ${taglineVisible ? "opacity-100" : "opacity-0"}`}>
                {TAGLINES[taglineIndex]}
              </span>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-ink-2">
            Charts, technicals, market movers and backtested forecasts for 20,000+ listings, in one place.
          </p>

          <ul className="stagger mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">
                  <Icon size={18} aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-sm text-ink-2">{text}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-10">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Markets now</div>
            <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(markets ?? Array.from({ length: 6 }, () => null)).map((q, i) =>
                q ? (
                  <div key={q.symbol} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-ink-2">{q.name.replace(/ \(.*\)/, "")}</div>
                      <div className="num text-sm font-semibold">{money(q.price, q.symbol.includes("=F") ? "USD" : null)}</div>
                      <Change value={q.change_pct} className="text-xs" />
                    </div>
                    <Sparkline values={q.spark} width={56} height={24} />
                  </div>
                ) : (
                  <div key={i} className="skeleton h-[74px] rounded-xl border border-line" />
                ),
              )}
            </div>
          </div>
        </section>

        <section className="animate-fade-up mx-auto w-full max-w-md" style={{ animationDelay: "120ms" }}>
          <AuthCard providers={providers} onSuccess={onSuccess} />
        </section>
      </main>

      <footer className="mx-auto w-full max-w-7xl px-4 pb-6 text-xs text-muted">
        Market data from Yahoo Finance, may be delayed. Forecasts and rankings are statistical estimates, not investment advice.
      </footer>
    </div>
  );
}
