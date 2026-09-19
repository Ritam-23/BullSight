"""Scalping view: 1/2/5-minute candles for the latest session with fast indicators and crossover signals."""
import threading
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

import indicators as ind
import market

INTERVALS = {"1m": "5d", "2m": "5d", "5m": "5d"}  # 5 days so the previous close is known
TTL = 15
_cache: dict[tuple, tuple[float, dict]] = {}
_lock = threading.Lock()


def _epoch(ts: pd.Timestamp) -> int:
    return int(ts.tz_localize("UTC").timestamp())


def scalp(symbol: str, interval: str = "1m") -> dict | None:
    if interval not in INTERVALS:
        raise ValueError("interval must be 1m, 2m or 5m")
    key = (symbol.upper(), interval)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]

    raw, source = None, symbol
    for sym in market._candidates(symbol):
        try:
            r = yf.Ticker(sym).history(period=INTERVALS[interval], interval=interval, auto_adjust=True, prepost=False)
        except Exception:  # noqa: BLE001
            continue
        if r is not None and len(r) >= 20:
            raw, source = r, sym
            break
    if raw is None:
        return None

    last_bar_utc = pd.Timestamp(raw.index[-1]).tz_convert("UTC")
    df = raw[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
    df.index = pd.to_datetime(df.index).tz_localize(None)  # exchange wall-clock time
    day = df.index.normalize()
    session = df[day == day[-1]]
    prev = df[day < day[-1]]
    prev_close = float(prev["Close"].iloc[-1]) if len(prev) else None

    c = session["Close"]
    ema9, ema21 = ind.ema(c, 9), ind.ema(c, 21)
    vw = ind.vwap(session)
    st_line, st_dir = ind.supertrend(session, 10, 3)
    rsi7 = ind.rsi(c, 7)
    atr = ind.atr(session, 14)

    # Signals: EMA 9/21 crosses, VWAP reclaims/losses, Supertrend flips.
    signals = []

    def crosses(a: pd.Series, b: pd.Series, name_up: str, name_dn: str, kind: str):
        diff = np.sign(a - b)
        flip = diff.diff()
        for t, v in flip.items():
            if v > 0 and pd.notna(diff.get(t)):
                signals.append({"time": _epoch(t), "side": "buy", "kind": kind, "label": name_up, "price": float(c[t])})
            elif v < 0 and pd.notna(diff.get(t)):
                signals.append({"time": _epoch(t), "side": "sell", "kind": kind, "label": name_dn, "price": float(c[t])})

    crosses(ema9, ema21, "EMA 9 crossed above EMA 21", "EMA 9 crossed below EMA 21", "ema")
    crosses(c, vw, "Price reclaimed VWAP", "Price lost VWAP", "vwap")
    flips = st_dir.diff()
    for t, v in flips.items():
        if t in st_line.dropna().index and v != 0 and pd.notna(v):
            signals.append({"time": _epoch(t), "side": "buy" if v > 0 else "sell", "kind": "supertrend",
                            "label": f"Supertrend flipped {'up' if v > 0 else 'down'}", "price": float(c[t])})
    signals.sort(key=lambda s: s["time"])

    last = float(c.iloc[-1])
    checks = {
        "Price vs VWAP": last > vw.iloc[-1],
        "EMA 9 vs EMA 21": ema9.iloc[-1] > ema21.iloc[-1],
        "Supertrend": st_dir.iloc[-1] == 1,
        "RSI (7) above 50": rsi7.iloc[-1] > 50,
    }
    ups = sum(bool(v) for v in checks.values())
    bias = "Long bias" if ups >= 3 else "Short bias" if ups <= 1 else "Choppy / no edge"
    a = float(atr.iloc[-1]) if pd.notna(atr.iloc[-1]) else None
    minutes_old = (datetime.now(timezone.utc) - last_bar_utc.to_pydatetime()).total_seconds() / 60

    def pts(s: pd.Series):
        return [{"time": _epoch(t), "value": round(float(v), 4)} for t, v in s.items() if pd.notna(v)]

    result = {
        "symbol": symbol.upper(), "source": source, "interval": interval,
        "session_date": day[-1].strftime("%Y-%m-%d"),
        "market_open": minutes_old < 10,
        "last_bar_minutes_ago": round(minutes_old, 1),
        "candles": [{"time": _epoch(t), "open": float(r.Open), "high": float(r.High), "low": float(r.Low),
                     "close": float(r.Close), "volume": float(r.Volume)} for t, r in session.iterrows()],
        "ema9": pts(ema9), "ema21": pts(ema21), "vwap": pts(vw),
        "st_up": pts(st_line.where(st_dir == 1)), "st_down": pts(st_line.where(st_dir == -1)), "rsi7": pts(rsi7),
        "signals": signals[-40:],
        "bias": {"label": bias, "checks": [{"name": k, "bullish": bool(v)} for k, v in checks.items()]},
        "stats": {
            "last": last, "open": float(session["Open"].iloc[0]), "high": float(session["High"].max()),
            "low": float(session["Low"].min()), "vwap": float(vw.iloc[-1]), "prev_close": prev_close,
            "change_pct": (last / prev_close - 1) * 100 if prev_close else None,
            "volume": float(session["Volume"].sum()), "atr": a, "rsi7": float(rsi7.iloc[-1]) if pd.notna(rsi7.iloc[-1]) else None,
        },
        # Illustrative 1×ATR stop / 1.5×ATR target in the direction of the bias. Not advice.
        "levels": None if a is None or bias.startswith("Choppy") else {
            "side": "long" if bias == "Long bias" else "short",
            "entry": last,
            "stop": last - a if bias == "Long bias" else last + a,
            "target": last + 1.5 * a if bias == "Long bias" else last - 1.5 * a,
        },
    }
    with _lock:
        _cache[key] = (time.time(), result)
    return result
