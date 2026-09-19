"""Technical indicators on an OHLCV DataFrame (columns Open, High, Low, Close, Volume)."""
import numpy as np
import pandas as pd


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def wilder(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(alpha=1 / n, adjust=False).mean()


def rsi(c: pd.Series, n: int = 14) -> pd.Series:
    d = c.diff()
    up, dn = wilder(d.clip(lower=0), n), wilder(-d.clip(upper=0), n)
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def true_range(df: pd.DataFrame) -> pd.Series:
    prev = df["Close"].shift()
    return pd.concat([df["High"] - df["Low"], (df["High"] - prev).abs(), (df["Low"] - prev).abs()], axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return wilder(true_range(df), n)


def supertrend(df: pd.DataFrame, n: int = 10, mult: float = 3.0) -> tuple[pd.Series, pd.Series]:
    """Returns (line, direction) where direction is +1 (uptrend, line below price) or -1."""
    h, l, c = df["High"].values, df["Low"].values, df["Close"].values
    a = atr(df, n).values
    mid = (h + l) / 2
    upper, lower = mid + mult * a, mid - mult * a
    line = np.full(len(c), np.nan)
    direction = np.ones(len(c))
    fu, fl = upper.copy(), lower.copy()
    for i in range(1, len(c)):
        fu[i] = upper[i] if upper[i] < fu[i - 1] or c[i - 1] > fu[i - 1] else fu[i - 1]
        fl[i] = lower[i] if lower[i] > fl[i - 1] or c[i - 1] < fl[i - 1] else fl[i - 1]
        if direction[i - 1] == 1:
            direction[i] = -1 if c[i] < fl[i] else 1
        else:
            direction[i] = 1 if c[i] > fu[i] else -1
        line[i] = fl[i] if direction[i] == 1 else fu[i]
    line[: n] = np.nan
    return pd.Series(line, df.index), pd.Series(direction, df.index)


def psar(df: pd.DataFrame, step: float = 0.02, max_step: float = 0.2) -> pd.Series:
    h, l = df["High"].values, df["Low"].values
    n = len(h)
    out = np.full(n, np.nan)
    if n < 3:
        return pd.Series(out, df.index)
    up = True
    af, ep, sar = step, h[0], l[0]
    for i in range(1, n):
        sar = sar + af * (ep - sar)
        if up:
            sar = min(sar, l[i - 1], l[i - 2] if i > 1 else l[i - 1])
            if l[i] < sar:
                up, sar, ep, af = False, ep, l[i], step
            elif h[i] > ep:
                ep, af = h[i], min(af + step, max_step)
        else:
            sar = max(sar, h[i - 1], h[i - 2] if i > 1 else h[i - 1])
            if h[i] > sar:
                up, sar, ep, af = True, ep, h[i], step
            elif l[i] < ep:
                ep, af = l[i], min(af + step, max_step)
        out[i] = sar
    return pd.Series(out, df.index)


def stochastic(df: pd.DataFrame, n: int = 14, k_smooth: int = 3, d_smooth: int = 3) -> tuple[pd.Series, pd.Series]:
    ll, hh = df["Low"].rolling(n).min(), df["High"].rolling(n).max()
    raw = 100 * (df["Close"] - ll) / (hh - ll).replace(0, np.nan)
    k = raw.rolling(k_smooth).mean()
    return k, k.rolling(d_smooth).mean()


def adx(df: pd.DataFrame, n: int = 14) -> tuple[pd.Series, pd.Series, pd.Series]:
    up, dn = df["High"].diff(), -df["Low"].diff()
    plus_dm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), df.index)
    minus_dm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), df.index)
    tr = wilder(true_range(df), n).replace(0, np.nan)
    plus_di, minus_di = 100 * wilder(plus_dm, n) / tr, 100 * wilder(minus_dm, n) / tr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return wilder(dx, n), plus_di, minus_di


def obv(df: pd.DataFrame) -> pd.Series:
    return (np.sign(df["Close"].diff()).fillna(0) * df["Volume"]).cumsum()


def cci(df: pd.DataFrame, n: int = 20) -> pd.Series:
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    ma = tp.rolling(n).mean()
    md = tp.rolling(n).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    return (tp - ma) / (0.015 * md.replace(0, np.nan))


def williams_r(df: pd.DataFrame, n: int = 14) -> pd.Series:
    hh, ll = df["High"].rolling(n).max(), df["Low"].rolling(n).min()
    return -100 * (hh - df["Close"]) / (hh - ll).replace(0, np.nan)


def ichimoku(df: pd.DataFrame) -> dict[str, pd.Series]:
    """Tenkan/Kijun plus the cloud spans *unshifted*; the caller shifts spans 26 bars forward."""
    mid = lambda n: (df["High"].rolling(n).max() + df["Low"].rolling(n).min()) / 2  # noqa: E731
    tenkan, kijun = mid(9), mid(26)
    return {"tenkan": tenkan, "kijun": kijun, "span_a": (tenkan + kijun) / 2, "span_b": mid(52)}


def vwap(df: pd.DataFrame) -> pd.Series:
    """Session VWAP, reset each calendar day."""
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    day = df.index.normalize()
    pv = (tp * df["Volume"]).groupby(day).cumsum()
    vol = df["Volume"].groupby(day).cumsum().replace(0, np.nan)
    return pv / vol
