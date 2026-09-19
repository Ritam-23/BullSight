"""Chart data (OHLCV + technical indicators) and a Groww-style analytics summary."""
import threading
import time

import numpy as np
import pandas as pd
import yfinance as yf

import indicators as ind
import market

# range -> (yahoo period to fetch, interval, how much of it to show).
# Daily ranges fetch extra history so long indicators (SMA 200) are valid from the first visible bar.
RANGES = {
    "1D": ("5d", "5m", "last_session"),
    "1W": ("1mo", "30m", pd.Timedelta(days=7)),
    "1M": ("2y", "1d", pd.DateOffset(months=1)),
    "3M": ("2y", "1d", pd.DateOffset(months=3)),
    "6M": ("2y", "1d", pd.DateOffset(months=6)),
    "1Y": ("5y", "1d", pd.DateOffset(years=1)),
    "3Y": ("10y", "1wk", pd.DateOffset(years=3)),
    "5Y": ("10y", "1wk", pd.DateOffset(years=5)),
    "MAX": ("max", "1mo", None),
}

INDICATOR_KEYS = ("sma20", "sma50", "sma200", "ema9", "ema20", "ema21", "bb_upper", "bb_mid", "bb_lower", "rsi14",
                  "rsi7", "macd", "macd_signal", "macd_hist", "vwap", "st_up", "st_down", "psar", "stoch_k", "stoch_d",
                  "adx", "plus_di", "minus_di", "atr", "obv", "cci", "willr", "ichi_tenkan", "ichi_kijun")

_cache: dict[tuple, tuple[float, dict]] = {}
_lock = threading.Lock()
INTRADAY_TTL = 60
DAILY_TTL = 15 * 60


def _ohlcv(symbol: str, period: str, interval: str) -> tuple[pd.DataFrame | None, str]:
    for sym in market._candidates(symbol):
        try:
            raw = yf.Ticker(sym).history(period=period, interval=interval, auto_adjust=True)
        except Exception:  # noqa: BLE001
            continue
        if raw is None or raw.empty or len(raw) < 2:
            continue
        df = raw[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        idx = pd.to_datetime(df.index)
        # Show exchange-local wall-clock time: drop the timezone without converting to UTC.
        df.index = idx.tz_localize(None) if idx.tz is not None else idx
        # Skip a truncated BSE series (see market.nse_twin) unless it is all we have.
        if interval == "1d" and len(df) < market.MIN_HISTORY and sym != market._candidates(symbol)[-1]:
            continue
        return df, sym
    return None, symbol


def _indicators(df: pd.DataFrame, intraday: bool) -> pd.DataFrame:
    c = df["Close"]
    out = pd.DataFrame(index=df.index)
    for n in (20, 50, 200):
        out[f"sma{n}"] = c.rolling(n).mean()
    for n in (9, 20, 21):
        out[f"ema{n}"] = ind.ema(c, n)
    mid, sd = c.rolling(20).mean(), c.rolling(20).std()
    out["bb_upper"], out["bb_mid"], out["bb_lower"] = mid + 2 * sd, mid, mid - 2 * sd
    out["rsi14"] = ind.rsi(c, 14)
    out["rsi7"] = ind.rsi(c, 7)
    macd = ind.ema(c, 12) - ind.ema(c, 26)
    out["macd"], out["macd_signal"] = macd, ind.ema(macd, 9)
    out["macd_hist"] = out["macd"] - out["macd_signal"]
    line, direction = ind.supertrend(df, 10, 3)
    out["st_up"] = line.where(direction == 1)
    out["st_down"] = line.where(direction == -1)
    out["st_dir"] = direction
    out["psar"] = ind.psar(df)
    out["stoch_k"], out["stoch_d"] = ind.stochastic(df)
    out["adx"], out["plus_di"], out["minus_di"] = ind.adx(df)
    out["atr"] = ind.atr(df)
    out["obv"] = ind.obv(df)
    out["cci"] = ind.cci(df)
    out["willr"] = ind.williams_r(df)
    ichi = ind.ichimoku(df)
    out["ichi_tenkan"], out["ichi_kijun"] = ichi["tenkan"], ichi["kijun"]
    # Cloud spans are stored unshifted; chart() moves them 26 bars forward (see _shifted).
    out["_span_a"], out["_span_b"] = ichi["span_a"], ichi["span_b"]
    if intraday:
        out["vwap"] = ind.vwap(df)
    return out


def _future_times(idx: pd.DatetimeIndex, k: int, interval: str) -> list[pd.Timestamp]:
    if interval == "1d":
        return list(pd.bdate_range(idx[-1] + pd.Timedelta(days=1), periods=k))
    step = pd.Series(idx).diff().median()
    return [idx[-1] + step * (i + 1) for i in range(k)]


def _shifted(s: pd.Series, k: int, future: list[pd.Timestamp]) -> pd.Series:
    """Series moved k bars forward in time, extending past the last bar."""
    times = list(s.index[k:]) + future[:k]
    return pd.Series(s.values, index=pd.DatetimeIndex(times))


def _epoch(ts: pd.Timestamp) -> int:
    return int(ts.tz_localize("UTC").timestamp()) if ts.tzinfo is None else int(ts.timestamp())


def chart(symbol: str, range_: str) -> dict | None:
    range_ = range_.upper()
    if range_ not in RANGES:
        raise ValueError(f"range must be one of {', '.join(RANGES)}")
    period, interval, window = RANGES[range_]
    key = (symbol.upper(), range_)
    ttl = INTRADAY_TTL if interval.endswith("m") else DAILY_TTL
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]

    df, source = _ohlcv(symbol, period, interval)
    if df is None:
        return None
    intraday = interval.endswith("m")
    if window is None:
        # MAX view: drop data before a >3x single-bar jump (an unadjusted split in Yahoo's history).
        jumps = np.where(np.abs(np.log(df["Close"]).diff()) > np.log(3))[0]
        if len(jumps) and len(df) - jumps[-1] >= 12:
            df = df.iloc[jumps[-1]:]
    inds = _indicators(df, intraday)

    prev_close = None
    if window == "last_session":
        days = df.index.normalize().unique()
        last_day = days[-1]
        if len(days) > 1:
            prev_close = float(df.loc[df.index.normalize() == days[-2], "Close"].iloc[-1])
        mask = df.index.normalize() == last_day
    elif window is None:
        mask = np.ones(len(df), bool)
    else:
        mask = df.index >= df.index[-1] - window
    future = _future_times(df.index, 26, interval)
    span_a, span_b = _shifted(inds["_span_a"], 26, future), _shifted(inds["_span_b"], 26, future)
    view, inds = df[mask], inds[mask]
    first = view.index[0]
    span_a, span_b = span_a[span_a.index >= first], span_b[span_b.index >= first]
    if prev_close is None and mask.argmax() > 0:
        prev_close = float(df["Close"].iloc[mask.argmax() - 1])
    base = prev_close if prev_close is not None else float(view["Open"].iloc[0])

    def pts(s: pd.Series):
        return [{"time": _epoch(t), "value": round(float(v), 4)} for t, v in s.items() if pd.notna(v)]

    def col(name):
        return pts(inds[name]) if name in inds else []

    last = float(view["Close"].iloc[-1])
    result = {
        "symbol": symbol.upper(),
        "data_source": source,
        "range": range_,
        "interval": interval,
        "intraday": intraday,
        "candles": [{"time": _epoch(t), "open": round(float(r.Open), 4), "high": round(float(r.High), 4),
                     "low": round(float(r.Low), 4), "close": round(float(r.Close), 4), "volume": float(r.Volume)}
                    for t, r in view.iterrows()],
        "indicators": {
            **{k: col(k) for k in INDICATOR_KEYS},
            "ichi_span_a": pts(span_a), "ichi_span_b": pts(span_b),
        },
        "summary": {
            "open": float(view["Open"].iloc[0]), "high": float(view["High"].max()), "low": float(view["Low"].min()),
            "close": last, "change": last - base, "change_pct": (last / base - 1) * 100 if base else None,
            "volume": float(view["Volume"].sum()),
        },
    }
    with _lock:
        _cache[key] = (time.time(), result)
    return result


def _ret(c: pd.Series, offset) -> float | None:
    start = c.index[-1] - offset
    past = c[c.index <= start]
    if past.empty:
        return None
    return float(c.iloc[-1] / past.iloc[-1] - 1) * 100


def analytics(symbol: str) -> dict | None:
    df = market.history(symbol, period="max")
    if df is None or len(df) < 30:
        return None
    # Yahoo's long histories sometimes carry unadjusted splits/bonuses, which show up as impossible
    # one-day jumps. Long-horizon stats only use data after the last such break.
    jumps = np.where(np.abs(np.log(df["Close"]).diff()) > np.log(1.4))[0]
    if len(jumps) and len(df) - jumps[-1] >= 30:
        df = df.iloc[jumps[-1]:]
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    last = float(c.iloc[-1])
    inds = _indicators(df, intraday=False)
    r = np.log(c).diff()

    returns = {k: _ret(c, off) for k, off in [
        ("1W", pd.Timedelta(days=7)), ("1M", pd.DateOffset(months=1)), ("3M", pd.DateOffset(months=3)),
        ("6M", pd.DateOffset(months=6)), ("1Y", pd.DateOffset(years=1)), ("3Y", pd.DateOffset(years=3)),
        ("5Y", pd.DateOffset(years=5)),
    ]}
    ytd = c[c.index < pd.Timestamp(year=c.index[-1].year, month=1, day=1)]
    returns["YTD"] = float(last / ytd.iloc[-1] - 1) * 100 if not ytd.empty else None
    for k, years in (("3Y", 3), ("5Y", 5)):
        if returns[k] is not None:
            returns[f"{k}_CAGR"] = ((1 + returns[k] / 100) ** (1 / years) - 1) * 100

    yr = df[df.index >= df.index[-1] - pd.DateOffset(years=1)]
    peak = c.cummax()
    dd = c / peak - 1
    one_y_dd = (yr["Close"] / yr["Close"].cummax() - 1).min()

    # Classic floor pivots from the last completed session.
    ph, pl, pc = float(h.iloc[-1]), float(l.iloc[-1]), last
    pivot = (ph + pl + pc) / 3
    levels = {"R3": ph + 2 * (pivot - pl), "R2": pivot + (ph - pl), "R1": 2 * pivot - pl, "Pivot": pivot,
              "S1": 2 * pivot - ph, "S2": pivot - (ph - pl), "S3": pl - 2 * (ph - pivot)}

    def lastv(name):
        s = inds[name].dropna()
        return float(s.iloc[-1]) if len(s) else None

    rsi, macd, sig = lastv("rsi14"), lastv("macd"), lastv("macd_signal")
    sma50, sma200 = lastv("sma50"), lastv("sma200")
    signals = []
    if rsi is not None:
        state = "Overbought" if rsi >= 70 else "Oversold" if rsi <= 30 else "Neutral"
        signals.append({"name": "RSI (14)", "value": round(rsi, 1), "signal": state,
                        "bias": {"Overbought": "bearish", "Oversold": "bullish"}.get(state, "neutral")})
    if macd is not None and sig is not None:
        signals.append({"name": "MACD (12, 26, 9)", "value": round(macd - sig, 4),
                        "signal": "Above signal line" if macd > sig else "Below signal line",
                        "bias": "bullish" if macd > sig else "bearish"})
    for n, val in ((20, lastv("sma20")), (50, sma50), (200, sma200)):
        if val is not None:
            signals.append({"name": f"Price vs SMA {n}", "value": round((last / val - 1) * 100, 2),
                            "signal": "Above" if last > val else "Below", "bias": "bullish" if last > val else "bearish"})
    if sma50 is not None and sma200 is not None:
        s50, s200 = inds["sma50"], inds["sma200"]
        cross = np.sign(s50 - s200).diff().fillna(0)
        crosses = cross[cross != 0]
        last_cross = None
        if len(crosses):
            t = crosses.index[-1]
            last_cross = {"type": "Golden cross" if crosses.iloc[-1] > 0 else "Death cross",
                          "date": t.strftime("%Y-%m-%d")}
        signals.append({"name": "SMA 50 vs SMA 200", "value": round((sma50 / sma200 - 1) * 100, 2),
                        "signal": ("Golden cross" if sma50 > sma200 else "Death cross") + " regime",
                        "bias": "bullish" if sma50 > sma200 else "bearish", "last_cross": last_cross})
    k, d = lastv("stoch_k"), lastv("stoch_d")
    if k is not None and d is not None:
        state = "Overbought" if k >= 80 else "Oversold" if k <= 20 else "%K above %D" if k > d else "%K below %D"
        bias = "bearish" if k >= 80 else "bullish" if k <= 20 else "bullish" if k > d else "bearish"
        signals.append({"name": "Stochastic (14, 3, 3)", "value": round(k, 1), "signal": state, "bias": bias})
    adx_v, pdi, mdi = lastv("adx"), lastv("plus_di"), lastv("minus_di")
    if adx_v is not None and pdi is not None and mdi is not None:
        strength = "Strong trend" if adx_v >= 25 else "Weak / no trend"
        signals.append({"name": "ADX (14)", "value": round(adx_v, 1),
                        "signal": f"{strength}, {'+DI' if pdi > mdi else '−DI'} leading",
                        "bias": "neutral" if adx_v < 20 else "bullish" if pdi > mdi else "bearish"})
    cci_v = lastv("cci")
    if cci_v is not None:
        signals.append({"name": "CCI (20)", "value": round(cci_v, 1),
                        "signal": "Overbought" if cci_v > 100 else "Oversold" if cci_v < -100 else "Neutral",
                        "bias": "bearish" if cci_v > 100 else "bullish" if cci_v < -100 else "neutral"})
    wr = lastv("willr")
    if wr is not None:
        signals.append({"name": "Williams %R (14)", "value": round(wr, 1),
                        "signal": "Overbought" if wr > -20 else "Oversold" if wr < -80 else "Neutral",
                        "bias": "bearish" if wr > -20 else "bullish" if wr < -80 else "neutral"})
    st_dir = inds["st_dir"].iloc[-1]
    st_line = lastv("st_up") if st_dir == 1 else lastv("st_down")
    if st_line is not None:
        signals.append({"name": "Supertrend (10, 3)", "value": round((last / st_line - 1) * 100, 2),
                        "signal": f"{'Uptrend' if st_dir == 1 else 'Downtrend'}, line at {st_line:,.2f}",
                        "bias": "bullish" if st_dir == 1 else "bearish"})
    sar = lastv("psar")
    if sar is not None:
        signals.append({"name": "Parabolic SAR", "value": round((last / sar - 1) * 100, 2),
                        "signal": "Price above SAR" if last > sar else "Price below SAR",
                        "bias": "bullish" if last > sar else "bearish"})
    # Ichimoku: price vs today's cloud (spans computed 26 bars ago).
    span_a, span_b = inds["_span_a"].shift(26).iloc[-1], inds["_span_b"].shift(26).iloc[-1]
    if pd.notna(span_a) and pd.notna(span_b):
        top, bottom = max(span_a, span_b), min(span_a, span_b)
        pos = "above" if last > top else "below" if last < bottom else "inside"
        signals.append({"name": "Ichimoku cloud", "value": round((last / top - 1) * 100, 2) if pos == "above" else
                        round((last / bottom - 1) * 100, 2), "signal": f"Price {pos} the cloud",
                        "bias": {"above": "bullish", "below": "bearish"}.get(pos, "neutral")})
    obv_s = inds["obv"].dropna()
    if len(obv_s) > 21:
        slope = obv_s.iloc[-1] - obv_s.iloc[-21]
        signals.append({"name": "OBV (20-day trend)", "value": round(float(slope) / max(float(v.tail(20).mean()), 1), 2),
                        "signal": "Accumulation (volume on up days)" if slope > 0 else "Distribution (volume on down days)",
                        "bias": "bullish" if slope > 0 else "bearish"})
    bull = sum(s["bias"] == "bullish" for s in signals)
    bear = sum(s["bias"] == "bearish" for s in signals)

    return {
        "symbol": symbol.upper(),
        "as_of": df.index[-1].strftime("%Y-%m-%d"),
        "price": last,
        "day": {"low": float(l.iloc[-1]), "high": float(h.iloc[-1]), "open": float(df["Open"].iloc[-1]),
                "prev_close": float(c.iloc[-2])},
        "week52": {"low": float(yr["Low"].min()), "high": float(yr["High"].max())},
        "all_time": {"low": float(l.min()), "high": float(h.max()), "since": df.index[0].strftime("%Y-%m-%d")},
        "returns": returns,
        "risk": {
            "volatility_1y": float(r.tail(252).std() * np.sqrt(252) * 100),
            "max_drawdown_1y": float(one_y_dd * 100),
            "max_drawdown_all": float(dd.min() * 100),
            "from_52w_high": (last / float(yr["High"].max()) - 1) * 100,
            "up_days_1y": float((r.tail(252) > 0).mean() * 100),
        },
        "volume": {"last": float(v.iloc[-1]), "avg_20d": float(v.tail(20).mean()), "avg_1y": float(v.tail(252).mean())},
        "levels": {k: round(val, 4) for k, val in levels.items()},
        "signals": signals,
        "technical_summary": "Bullish" if bull >= bear + 2 else "Bearish" if bear >= bull + 2 else "Neutral",
        "signal_counts": {"bullish": bull, "bearish": bear, "neutral": len(signals) - bull - bear},
    }
