"""Price forecasting with honest, walk-forward evaluation.

For each horizon (1, 5, 10, 20 trading days) we predict the forward log return from technical
features, using an ensemble of a ridge regression and a gradient-boosted tree model. Every model is
evaluated out-of-sample with a walk-forward backtest (the model only ever sees data that would have
been available at prediction time) and compared against the naive random-walk baseline
("the price stays where it is"). The metrics returned are exactly what the backtest measured.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HORIZONS = [1, 5, 10, 20]
TEST_DAYS = 250
VAL_DAYS = 250
REFIT_EVERY = 84
SHRINK = (0.25, 0.5, 1.0)
MIN_ROWS = 320

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
CACHE_TTL = 6 * 3600


def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    down = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / down.replace(0, np.nan))


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"].replace(0, np.nan)
    r = np.log(c).diff()
    f = pd.DataFrame(index=df.index)
    for lag in range(5):
        f[f"ret_lag{lag + 1}"] = r.shift(lag)
    for n in (5, 10, 20, 60):
        f[f"mom_{n}"] = np.log(c / c.shift(n))
    f["vol_10"] = r.rolling(10).std()
    f["vol_20"] = r.rolling(20).std()
    f["vol_ratio"] = f["vol_10"] / f["vol_20"]
    f["rsi_14"] = _rsi(c) / 100 - 0.5
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    f["macd_hist"] = (macd - macd.ewm(span=9, adjust=False).mean()) / c
    for n in (20, 50, 200):
        f[f"sma{n}_gap"] = c / c.rolling(n).mean() - 1
    mid, sd = c.rolling(20).mean(), c.rolling(20).std()
    f["bb_pctb"] = (c - (mid - 2 * sd)) / (4 * sd)
    lv = np.log(v)
    f["volume_z"] = (lv - lv.rolling(20).mean()) / lv.rolling(20).std()
    f["range_5"] = ((h - l) / c).rolling(5).mean()
    f["close_loc"] = ((c - l) / (h - l).replace(0, np.nan)).rolling(5).mean()
    return f.replace([np.inf, -np.inf], np.nan)


def _models():
    ridge = make_pipeline(StandardScaler(), Ridge(alpha=30.0))
    gbm = HistGradientBoostingRegressor(max_iter=80, learning_rate=0.06, max_depth=3, min_samples_leaf=40,
                                        l2_regularization=1.0, random_state=0)
    return {"ridge": ridge, "gbm": gbm}


def _walk_forward(X: np.ndarray, y: np.ndarray, h: int, test_start: int) -> dict[str, np.ndarray]:
    """Out-of-sample predictions for rows test_start..end, refitting every REFIT_EVERY rows.

    When predicting row i, a training row j is only usable if its target (close at j+h) is known at
    time i, i.e. j + h <= i. This prevents look-ahead leakage for multi-day horizons.
    """
    n = len(X)
    preds = {"ridge": np.full(n, np.nan), "gbm": np.full(n, np.nan)}
    for start in range(test_start, n, REFIT_EVERY):
        end = min(start + REFIT_EVERY, n)
        train_end = start - h + 1
        if train_end < 120:
            continue
        for name, m in _models().items():
            m.fit(X[:train_end], y[:train_end])
            preds[name][start:end] = m.predict(X[start:end])
    preds["ensemble"] = (preds["ridge"] + preds["gbm"]) / 2
    return preds


def _regression_metrics(pred_r: np.ndarray, true_r: np.ndarray,
                        predicted: np.ndarray, actual: np.ndarray) -> dict:
    """Standard regression metrics (MSE, RMSE, MAE, R2, RSE) on the out-of-sample test window.

    Reported on two scales: the model's actual target (forward LOG RETURNS) — the honest measure of
    predictive skill — and on reconstructed PRICE, which looks flattering because price is dominated
    by its own level. R2 is 1 - SS_res/SS_tot; RSE is the residual standard error sqrt(SS_res/(n-2))
    (ISLR sense); relative_squared_error (RSE's ML cousin) is SS_res/SS_tot = 1 - R2.
    """
    def _block(pred: np.ndarray, true: np.ndarray) -> dict:
        n = len(true)
        resid = pred - true
        ss_res = float(np.sum(resid ** 2))
        ss_tot = float(np.sum((true - np.mean(true)) ** 2))
        mse = float(np.mean(resid ** 2))
        return {
            "n": int(n),
            "mse": mse,
            "rmse": float(np.sqrt(mse)),
            "mae": float(np.mean(np.abs(resid))),
            "r2": (1 - ss_res / ss_tot) if ss_tot > 0 else None,
            "rse": float(np.sqrt(ss_res / (n - 2))) if n > 2 else None,
            "relative_squared_error": (ss_res / ss_tot) if ss_tot > 0 else None,
        }
    return {"log_return": _block(pred_r, true_r), "price": _block(predicted, actual)}


def _round_deep(obj, nd=6):
    if isinstance(obj, dict):
        return {k: _round_deep(v, nd) for k, v in obj.items()}
    if isinstance(obj, float):
        return round(obj, nd)
    return obj


def _metrics(pred_r: np.ndarray, true_r: np.ndarray, base_close: np.ndarray) -> dict:
    actual = base_close * np.exp(true_r)
    predicted = base_close * np.exp(pred_r)
    mape = float(np.mean(np.abs(predicted - actual) / actual))
    mape_naive = float(np.mean(np.abs(base_close - actual) / actual))
    moved = true_r != 0
    # A no-change forecast has no direction, so a hit rate is undefined for it.
    hit = float(np.mean(np.sign(pred_r[moved]) == np.sign(true_r[moved]))) if np.any(pred_r) else None
    up_share = float(np.mean(true_r[moved] > 0))
    return {
        "price_accuracy": round(100 * (1 - mape), 2),
        "naive_price_accuracy": round(100 * (1 - mape_naive), 2),
        "mape": round(100 * mape, 3),
        "naive_mape": round(100 * mape_naive, 3),
        "skill_vs_naive": round(100 * (1 - mape / mape_naive), 2) if mape_naive else 0.0,
        "directional_accuracy": round(100 * hit, 1) if hit is not None else None,
        "always_up_accuracy": round(100 * max(up_share, 1 - up_share), 1),
        "regression": _round_deep(_regression_metrics(pred_r, true_r, predicted, actual)),
    }


def _future_dates(last: pd.Timestamp, n: int) -> list[pd.Timestamp]:
    out, d = [], last
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            out.append(d)
    return out


def _horizon(h, feats, close, log_close, valid, last_close, last_date, dates) -> dict:
    target = np.full(len(close), np.nan)
    target[:-h] = log_close[h:] - log_close[:-h]
    rows = np.where(valid & ~np.isnan(target))[0]
    X, y = feats.values[rows], target[rows]
    base_close = close[rows]
    n = len(rows)
    test_len = min(TEST_DAYS, n // 5)
    val_len = min(VAL_DAYS, n // 5)
    test_start = n - test_len
    val_start = test_start - val_len

    # One walk-forward pass covers validation + test. Model choice (and how strongly to trust it)
    # is decided on the validation window only; the test window is then scored untouched.
    oos = _walk_forward(X, y, h, val_start)
    val = np.zeros(n, bool)
    val[val_start:test_start] = True
    test = np.zeros(n, bool)
    test[test_start:] = True

    candidates = {("naive", 0.0): np.zeros(n)}
    for name, p in oos.items():
        for k in SHRINK:
            candidates[(name, k)] = p * k
    # Stretches with too little training data have no model prediction; treat them as naive.
    candidates = {c: np.nan_to_num(p, nan=0.0) for c, p in candidates.items()}
    val_mae = {c: float(np.mean(np.abs(p[val] - y[val]))) for c, p in candidates.items()}
    best_name, shrink = min(val_mae, key=val_mae.get)
    best_pred = candidates[(best_name, shrink)]
    best = _metrics(best_pred[test], y[test], base_close[test])
    # Each test row: what was known at the start (base), what the model said, what happened h days later.
    idx = rows[test]
    series = [{"date": dates[i + h].strftime("%Y-%m-%d"), "base": round(float(b), 4),
               "predicted": round(float(b * np.exp(p)), 4), "actual": round(float(b * np.exp(a)), 4)}
              for i, b, p, a in zip(idx, base_close[test], best_pred[test], y[test])]
    residuals = y[test] - best_pred[test]
    q_lo, q_hi = np.quantile(residuals, [0.1, 0.9])

    # Final fit on every row whose target is known, then predict from today's features.
    r_hat = 0.0
    if best_name != "naive":
        final = _models()
        for m in final.values():
            m.fit(X, y)
        x_now = np.nan_to_num(feats.values[-1:], nan=0.0)
        preds = {name: float(m.predict(x_now)[0]) for name, m in final.items()}
        preds["ensemble"] = (preds["ridge"] + preds["gbm"]) / 2
        r_hat = preds[best_name] * shrink

    return {
        "days": h,
        "date": _future_dates(last_date, h)[-1].strftime("%Y-%m-%d"),
        "predicted_price": round(last_close * float(np.exp(r_hat)), 4),
        "low": round(last_close * float(np.exp(r_hat + q_lo)), 4),
        "high": round(last_close * float(np.exp(r_hat + q_hi)), 4),
        "change_pct": round(100 * (float(np.exp(r_hat)) - 1), 3),
        "model": best_name if best_name == "naive" or shrink == 1.0 else f"{best_name} x{shrink:g}",
        "beats_naive": best["mape"] < best["naive_mape"],
        "backtest": {**best, "test_days": int(test.sum()), "series": series},
    }


def forecast(symbol: str, df: pd.DataFrame) -> dict:
    key = f"{symbol.upper()}:{df.index[-1].date()}"
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]

    if len(df) < MIN_ROWS:
        raise ValueError(f"Need at least {MIN_ROWS} trading days of history; {symbol} has {len(df)}.")

    feats = build_features(df)
    if len(df) < 500:
        feats = feats.drop(columns=["sma200_gap"])
    close = df["Close"].values
    log_close = np.log(close)
    valid = feats.notna().all(axis=1).values
    last_close = float(close[-1])
    last_date = df.index[-1]

    with ThreadPoolExecutor(max_workers=len(HORIZONS)) as pool:
        horizons_out = list(pool.map(
            lambda h: _horizon(h, feats, close, log_close, valid, last_close, last_date, df.index), HORIZONS))

    h20 = horizons_out[-1]
    if h20["low"] > last_close:
        outlook = "Bullish"
    elif h20["high"] < last_close:
        outlook = "Bearish"
    elif h20["change_pct"] > 0.5:
        outlook = "Mildly bullish"
    elif h20["change_pct"] < -0.5:
        outlook = "Mildly bearish"
    else:
        outlook = "Neutral"

    result = {
        "symbol": symbol.upper(),
        "last_close": round(last_close, 4),
        "as_of": last_date.strftime("%Y-%m-%d"),
        "outlook": outlook,
        "horizons": horizons_out,
        "history": [{"date": d.strftime("%Y-%m-%d"), "close": round(float(c), 4)}
                    for d, c in zip(df.index[-180:], close[-180:])],
        "method": ("Ridge regression and gradient-boosted trees on 23 technical features, retrained every ~4 "
                   "months in a walk-forward backtest. The model (or the naive no-change forecast, if nothing "
                   "beat it) is chosen on a validation year, then scored on the following, untouched test year "
                   "(~250 trading days). Band = 10th-90th percentile of test-period errors."),
    }
    with _lock:
        _cache[key] = (time.time(), result)
    return result
