"""Market data via Yahoo Finance (yfinance), with in-memory and on-disk caching."""
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import yfinance as yf

import config
import symbols

_hist_cache: dict[tuple, tuple[float, pd.DataFrame]] = {}
_hist_lock = threading.Lock()
HIST_TTL = 15 * 60

FUNDAMENTALS_FILE = config.DATA_DIR / "fundamentals.json"
FUND_TTL = 24 * 3600
_fund_lock = threading.Lock()
_fundamentals: dict[str, dict] = json.loads(FUNDAMENTALS_FILE.read_text()) if FUNDAMENTALS_FILE.exists() else {}

FUND_FIELDS = {
    "shortName": "name", "longName": "long_name", "sector": "sector", "industry": "industry",
    "marketCap": "market_cap", "trailingPE": "pe", "forwardPE": "forward_pe", "priceToBook": "pb",
    "profitMargins": "profit_margin", "returnOnEquity": "roe", "revenueGrowth": "revenue_growth",
    "earningsGrowth": "earnings_growth", "dividendYield": "dividend_yield", "beta": "beta",
    "fiftyTwoWeekHigh": "high_52w", "fiftyTwoWeekLow": "low_52w", "currency": "currency",
    "recommendationKey": "analyst_rating", "targetMeanPrice": "analyst_target",
    "numberOfAnalystOpinions": "analyst_count", "longBusinessSummary": "summary",
}


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df


MIN_HISTORY = 30


def nse_twin(symbol: str) -> str | None:
    """NSE listing of a BSE stock. Yahoo's BSE (.BO) history is often truncated to a single day,
    while the same company's NSE series is complete; the two prices track closely via arbitrage."""
    if not symbol.upper().endswith(".BO"):
        return None
    twin = symbol[:-3] + ".NS"
    return twin if symbols.lookup(twin) else None


def _candidates(symbol: str) -> list[str]:
    out = [symbol]
    meta = symbols.lookup(symbol)
    if meta and meta.get("alt") and meta["alt"] != symbol:
        out.append(meta["alt"])  # BSE numeric scrip code
    twin = nse_twin(symbol)
    if twin:
        out.append(twin)
    return out


def history(symbol: str, period: str = "5y") -> pd.DataFrame | None:
    key = (symbol.upper(), period)
    with _hist_lock:
        hit = _hist_cache.get(key)
        if hit and time.time() - hit[0] < HIST_TTL:
            return hit[1]
    df = None
    for sym in _candidates(symbol):
        try:
            raw = yf.Ticker(sym).history(period=period, interval="1d", auto_adjust=True)
        except Exception as e:  # noqa: BLE001
            print(f"history({sym}) failed: {e}")
            continue
        if raw is not None and len(raw) >= MIN_HISTORY:
            df = _clean(raw)
            df.attrs["source_symbol"] = sym
            break
    if df is not None:
        with _hist_lock:
            _hist_cache[key] = (time.time(), df)
    return df


def batch_history(tickers: list[str], period: str = "6mo") -> dict[str, pd.DataFrame]:
    """Download many tickers at once; returns {symbol: OHLCV frame}."""
    out = _batch(tickers, period)
    # Retry BSE tickers with truncated history via their NSE twin (see nse_twin).
    twins = {nse_twin(s): s for s in tickers if s not in out and nse_twin(s)}
    if twins:
        for twin, df in _batch(list(twins), period).items():
            df.attrs["source_symbol"] = twin
            out[twins[twin]] = df
    return out


def _batch(tickers: list[str], period: str) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(tickers), 100):
        chunk = tickers[i:i + 100]
        try:
            raw = yf.download(chunk, period=period, interval="1d", group_by="ticker", auto_adjust=True,
                              threads=True, progress=False)
        except Exception as e:  # noqa: BLE001
            print("batch download failed:", e)
            continue
        for sym in chunk:
            try:
                sub = raw[sym] if isinstance(raw.columns, pd.MultiIndex) else raw
                sub = _clean(sub.copy())
                if len(sub) >= MIN_HISTORY:
                    out[sym] = sub
            except (KeyError, ValueError):
                continue
    return out


def _fetch_info(symbol: str) -> dict:
    try:
        info = yf.Ticker(symbol).info or {}
    except Exception:  # noqa: BLE001
        info = {}
    return {dst: info.get(src) for src, dst in FUND_FIELDS.items()}


def fundamentals(symbols_: list[str], max_workers: int = 12) -> dict[str, dict]:
    now = time.time()
    with _fund_lock:
        missing = [s for s in symbols_ if s not in _fundamentals or now - _fundamentals[s].get("_ts", 0) > FUND_TTL]
    if missing:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            fetched = dict(zip(missing, pool.map(_fetch_info, missing)))
        with _fund_lock:
            for s, info in fetched.items():
                _fundamentals[s] = {**info, "_ts": now}
            FUNDAMENTALS_FILE.write_text(json.dumps(_fundamentals))
    with _fund_lock:
        return {s: {k: v for k, v in _fundamentals.get(s, {}).items() if k != "_ts"} for s in symbols_}


_live_cache: dict[str, tuple[float, dict]] = {}
LIVE_TTL = 30


def live_price(symbol: str) -> dict | None:
    """Latest traded price (intraday when the market is open), cached for 30 seconds."""
    key = symbol.upper()
    hit = _live_cache.get(key)
    if hit and time.time() - hit[0] < LIVE_TTL:
        return hit[1]
    for sym in _candidates(symbol):
        try:
            fi = yf.Ticker(sym).fast_info
            price = float(fi.last_price or 0)
            prev = float(fi.previous_close or 0)
        except Exception:  # noqa: BLE001
            continue
        if price > 0:
            out = {"symbol": key, "source": sym, "price": price, "previous_close": prev or None,
                   "change_pct": (price / prev - 1) * 100 if prev else None}
            _live_cache[key] = (time.time(), out)
            return out
    return None


def usd_inr() -> float:
    q = live_price("USDINR=X")
    if not q:
        raise RuntimeError("USD/INR exchange rate unavailable")
    return q["price"]


def cached_fundamentals(symbols_: list[str]) -> dict[str, dict]:
    """Fundamentals already on disk, without any network calls."""
    with _fund_lock:
        return {s: {k: v for k, v in _fundamentals[s].items() if k != "_ts"} for s in symbols_ if s in _fundamentals}


def quotes(tickers: list[str]) -> list[dict]:
    """Last close and daily change for a small list of tickers (used for index cards)."""
    data = batch_history(tickers, period="3mo")
    out = []
    for sym in tickers:
        df = data.get(sym)
        if df is None or len(df) < 2:
            continue
        last, prev = float(df["Close"].iloc[-1]), float(df["Close"].iloc[-2])
        out.append({"symbol": sym, "price": last, "change": last - prev, "change_pct": (last / prev - 1) * 100,
                    "spark": [round(float(v), 2) for v in df["Close"].tail(22)],
                    "as_of": df.index[-1].strftime("%Y-%m-%d")})
    return out
