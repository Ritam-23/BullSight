export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  if (res.status === 401 && typeof window !== "undefined") {
    // Expired or invalid session: clear the cookie first so "/" shows sign-in instead of looping.
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
    throw new ApiError(401, "Not authenticated");
  }
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Request failed");
  }
  return res.json() as Promise<T>;
}

export type User = { id: string; name: string; email: string | null; avatar: string | null; provider: string };

export type SearchHit = { symbol: string; name: string; exchange: string; currency: string; type: string; via_sector?: boolean };
export type SectorHit = { slug: string; name: string; region: string; count: number; source: string };
export type SearchResult = { stocks: SearchHit[]; sectors: SectorHit[] };

export type IndexQuote = {
  symbol: string; name: string; currency: string; price: number; change: number; change_pct: number;
  spark: number[]; as_of: string;
};

export type BacktestPoint = { date: string; base: number; predicted: number; actual: number };

export type Backtest = {
  price_accuracy: number; naive_price_accuracy: number; mape: number; naive_mape: number;
  skill_vs_naive: number; directional_accuracy: number | null; always_up_accuracy: number; test_days: number;
  series: BacktestPoint[];
};

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type SeriesPoint = { time: number; value: number };

export type ChartData = {
  symbol: string; data_source: string; range: string; interval: string; intraday: boolean;
  candles: Candle[];
  indicators: Record<string, SeriesPoint[]>;
  summary: { open: number; high: number; low: number; close: number; change: number; change_pct: number | null; volume: number };
};

export type Signal = {
  name: string; value: number; signal: string; bias: "bullish" | "bearish" | "neutral";
  last_cross?: { type: string; date: string } | null;
};

export type Analytics = {
  symbol: string; as_of: string; price: number;
  day: { low: number; high: number; open: number; prev_close: number };
  week52: { low: number; high: number };
  all_time: { low: number; high: number; since: string };
  returns: Record<string, number | null>;
  risk: { volatility_1y: number; max_drawdown_1y: number; max_drawdown_all: number; from_52w_high: number; up_days_1y: number };
  volume: { last: number; avg_20d: number; avg_1y: number };
  levels: Record<"R3" | "R2" | "R1" | "Pivot" | "S1" | "S2" | "S3", number>;
  signals: Signal[];
  technical_summary: "Bullish" | "Bearish" | "Neutral";
  signal_counts: { bullish: number; bearish: number; neutral: number };
};

export type Horizon = {
  days: number; date: string; predicted_price: number; low: number; high: number; change_pct: number;
  model: string; beats_naive: boolean; backtest: Backtest;
};

export type Forecast = {
  symbol: string; last_close: number; as_of: string; outlook: string; horizons: Horizon[];
  history: { date: string; close: number }[]; method: string; data_source: string;
};

export type StockInfo = {
  symbol: string; name: string; exchange: string; currency: string | null; type: string;
  price: number; change: number; change_pct: number; volume: number; as_of: string; data_source: string;
  fundamentals: Record<string, number | string | null>;
};

export type ScreenRow = {
  symbol: string; name: string; data_source: string; as_of: string; price: number; change_pct: number | null;
  return_1m: number | null; return_3m: number | null; avg_volume: number; volume_surge: number | null;
  buying_pressure: number; volatility: number; score: number; sector: string | null;
  market_cap: number | null; pe: number | null; profit_margin: number | null; roe: number | null;
  spark: number[];
};

export type ScreenResult = {
  universe: string; label: string; currency: string; scanned: number; matched: number; latest: string | null;
  sectors: string[]; results: ScreenRow[];
};

export type Quote = {
  symbol: string; name: string; price: number; currency: string; fx: number; price_inr: number;
  change_pct: number | null; source: string;
};

export type Holding = {
  symbol: string; name: string; qty: number; avg_price: number; currency: string; price: number;
  change_pct: number | null; invested_inr: number; value_inr: number; pnl_inr: number; pnl_pct: number | null; day_pnl_inr: number;
};

export type Portfolio = {
  user: User;
  wallet: { balance_inr: number };
  summary: {
    invested_inr: number; current_inr: number; pnl_inr: number; pnl_pct: number | null; day_pnl_inr: number;
    realized_pnl_inr: number; net_worth_inr: number; usd_inr: number;
  };
  holdings: Holding[];
  orders: { symbol: string; side: "buy" | "sell"; qty: number; price: number; currency: string; amount_inr: number; realized_pnl_inr: number | null; at: number }[];
  transactions: { kind: string; amount_inr: number; balance_inr: number; ref: string | null; at: number }[];
};

export type WatchItem = { symbol: string; name: string; currency: string | null; price: number | null; change_pct: number | null };

export type WalletConfig = {
  provider: "stripe"; mode: "off" | "test" | "live-blocked"; publishable_key: string | null; demo_credit: boolean; min: number; max: number;
};

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export type NewsItem = {
  title: string; summary: string; url: string | null; thumbnail: string | null; publisher: string | null;
  published: string | null; type: string; relevance: "direct" | "related";
};
export type StockEvent = { type: "earnings" | "ex_dividend" | "dividend"; date: string | null; title: string; days_away: number | null; detail: Record<string, number | null> };
export type NewsData = {
  symbol: string; source: string; currency: string | null; news: NewsItem[]; upcoming: StockEvent[];
  earnings: { date: string | null; eps_estimate: number | null; eps_reported: number | null; surprise_pct: number | null }[];
  dividends: { date: string | null; value: number }[]; splits: { date: string | null; value: number }[];
};

export type ScalpSignal = { time: number; side: "buy" | "sell"; kind: "ema" | "vwap" | "supertrend"; label: string; price: number };
export type ScalpData = {
  symbol: string; source: string; interval: string; session_date: string; market_open: boolean; last_bar_minutes_ago: number;
  candles: Candle[]; ema9: SeriesPoint[]; ema21: SeriesPoint[]; vwap: SeriesPoint[]; st_up: SeriesPoint[]; st_down: SeriesPoint[]; rsi7: SeriesPoint[];
  signals: ScalpSignal[];
  bias: { label: string; checks: { name: string; bullish: boolean }[] };
  stats: { last: number; open: number; high: number; low: number; vwap: number; prev_close: number | null; change_pct: number | null; volume: number; atr: number | null; rsi7: number | null };
  levels: { side: "long" | "short"; entry: number; stop: number; target: number } | null;
};
