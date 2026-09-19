"""Suggestion engine: scans an exchange universe and ranks stocks by user-selected filters.

"Buyers" is estimated from price/volume data (Chaikin Money Flow and volume surge), because
free data sources do not publish order-book buyer counts.
"""
import threading
import time

import numpy as np
import pandas as pd

import market
import symbols

UNIVERSES = {
    "NASDAQ": {"label": "NASDAQ (large caps)", "currency": "USD"},
    "SP500": {"label": "S&P 500", "currency": "USD"},
    "NIFTY50": {"label": "NIFTY 50 (NSE)", "currency": "INR"},
    "SENSEX": {"label": "SENSEX (BSE)", "currency": "INR"},
    "BSE": {"label": "BSE top 150 by market cap", "currency": "INR"},
    "GOLD_SILVER_IN": {"label": "Gold & silver ETFs (India)", "currency": "INR"},
    "GOLD_SILVER_US": {"label": "Gold & silver ETFs (US)", "currency": "USD"},
}
SCAN_TTL = 30 * 60
# Fundamentals for every stock, so "most profitable" isn't limited to technically strong names.
# One request per stock on the first scan, then cached on disk for 24h.
FUNDAMENTALS_TOP_N = 1000
_scan_cache: dict[str, tuple[float, list[dict]]] = {}
_scan_locks = {u: threading.Lock() for u in UNIVERSES}

SORT_FIELDS = {
    "score": "score", "volume": "avg_volume", "buyers": "buying_pressure", "momentum": "return_3m",
    "return_1m": "return_1m", "profit": "profit_margin", "market_cap": "market_cap", "pe": "pe",
    "volume_surge": "volume_surge", "change": "change_pct",
}


def _technicals(sym: str, df: pd.DataFrame) -> dict:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    rng = (h - l).replace(0, np.nan)
    mfv = ((c - l) - (h - c)) / rng * v
    cmf = float(mfv.tail(20).sum() / v.tail(20).sum()) if v.tail(20).sum() else 0.0
    r = np.log(c).diff()
    avg20 = float(v.tail(20).mean())

    def ret(offset):
        # Calendar-based, so stocks with missing bars are compared over the same dates.
        past = c[c.index <= c.index[-1] - offset]
        return float(c.iloc[-1] / past.iloc[-1] - 1) * 100 if len(past) else None

    return {
        "symbol": sym,
        "data_source": df.attrs.get("source_symbol", sym),
        "price": float(c.iloc[-1]),
        "as_of": c.index[-1].strftime("%Y-%m-%d"),
        "change_pct": float(c.iloc[-1] / c.iloc[-2] - 1) * 100,
        "return_1m": ret(pd.DateOffset(months=1)),
        "return_3m": ret(pd.DateOffset(months=3)),
        "avg_volume": avg20,
        "volume": float(v.iloc[-1]),
        "turnover_today": float(c.iloc[-1] * v.iloc[-1]),
        "high_52w": float(h.tail(252).max()),
        "low_52w": float(l.tail(252).min()),
        "from_high": float(c.iloc[-1] / h.tail(252).max() - 1) * 100,
        "from_low": float(c.iloc[-1] / l.tail(252).min() - 1) * 100,
        "volume_surge": float(v.tail(5).mean() / avg20) if avg20 else None,
        "buying_pressure": round(cmf, 4),
        "volatility": float(r.tail(20).std() * np.sqrt(252) * 100),
        "turnover": float((c * v).tail(20).mean()),
        "spark": [round(float(x), 2) for x in c.tail(30)],
    }


def _pct_rank(values: list, higher_is_better=True) -> np.ndarray:
    s = pd.Series(values, dtype=float)
    rk = s.rank(pct=True, ascending=higher_is_better)
    return rk.fillna(0.5).values


def _score(rows: list[dict]) -> None:
    """Composite 0-100 score: momentum, buying pressure, profitability, liquidity, stability."""
    if not rows:
        return
    parts = {
        "return_3m": (0.25, True), "return_1m": (0.10, True), "buying_pressure": (0.20, True),
        "volume_surge": (0.10, True), "profit_margin": (0.20, True), "volatility": (0.15, False),
    }
    total = np.zeros(len(rows))
    for field, (w, hib) in parts.items():
        total += w * _pct_rank([r.get(field) for r in rows], hib)
    for r, t in zip(rows, total):
        r["score"] = round(float(t) * 100, 1)


def scan(universe: str) -> list[dict]:
    universe = universe.upper()
    if universe not in UNIVERSES:
        raise ValueError(f"Unknown universe {universe}")
    with _scan_locks[universe]:
        hit = _scan_cache.get(universe)
        if hit and time.time() - hit[0] < SCAN_TTL:
            return hit[1]
        tickers = symbols.constituents(universe)
        data = market.batch_history(tickers, period="1y")
        rows = [_technicals(s, df) for s, df in data.items()]

        pre = sorted(rows, key=lambda r: (r["return_3m"] or 0) + 100 * r["buying_pressure"], reverse=True)
        fund = market.cached_fundamentals([r["symbol"] for r in pre[FUNDAMENTALS_TOP_N:]])
        fund.update(market.fundamentals([r["symbol"] for r in pre[:FUNDAMENTALS_TOP_N]]))
        for r in rows:
            f = fund.get(r["symbol"], {})
            meta = symbols.lookup(r["symbol"]) or {}
            r.update({
                "name": f.get("name") or meta.get("name") or r["symbol"],
                "sector": f.get("sector"),
                "market_cap": f.get("market_cap"),
                "pe": f.get("pe"),
                "profit_margin": (f["profit_margin"] * 100) if f.get("profit_margin") is not None else None,
                "roe": (f["roe"] * 100) if f.get("roe") is not None else None,
                "revenue_growth": (f["revenue_growth"] * 100) if f.get("revenue_growth") is not None else None,
            })
        _score(rows)
        _scan_cache[universe] = (time.time(), rows)
        return rows


MOVER_CATEGORIES = {
    # id: (label, field, descending, description)
    "gainers": ("Top gainers", "change_pct", True, "Biggest rise in the last session"),
    "losers": ("Top losers", "change_pct", False, "Biggest fall in the last session"),
    "active": ("Most active", "turnover_today", True, "Highest traded value (price × volume) in the last session"),
    "volume": ("Highest volume", "volume", True, "Most shares traded in the last session"),
    "shockers": ("Volume shockers", "volume_surge", True, "5-day volume far above the 20-day average"),
    "profitable": ("Most profitable", "profit_margin", True, "Highest net profit margin (trailing 12 months)"),
    "near_high": ("Near 52W high", "from_high", True, "Trading closest to their 52-week high"),
    "near_low": ("Near 52W low", "from_low", False, "Trading closest to their 52-week low"),
    "momentum": ("Top 3M performers", "return_3m", True, "Best 3-month returns"),
}


def movers(universe: str, limit: int = 8) -> dict:
    rows = scan(universe)
    latest = max((r["as_of"] for r in rows), default=None)
    # Daily movers only make sense for stocks that traded in the latest session.
    fresh = [r for r in rows if r["as_of"] == latest]
    out = {}
    for cid, (label, field, desc, blurb) in MOVER_CATEGORIES.items():
        pool = fresh if field in ("change_pct", "turnover_today", "volume") else rows
        ranked = sorted((r for r in pool if r.get(field) is not None), key=lambda r: r[field], reverse=desc)
        if cid == "gainers":
            ranked = [r for r in ranked if r["change_pct"] > 0]
        elif cid == "losers":
            ranked = [r for r in ranked if r["change_pct"] < 0]
        keep = ("symbol", "name", "price", "change_pct", "volume", "turnover_today", "volume_surge", "profit_margin",
                "high_52w", "low_52w", "from_high", "from_low", "return_3m", "spark", "as_of")
        out[cid] = {"label": label, "field": field, "description": blurb,
                    "items": [{k: r.get(k) for k in keep} for r in ranked[:limit]]}
    return {"universe": universe.upper(), "label": UNIVERSES[universe.upper()]["label"],
            "currency": UNIVERSES[universe.upper()]["currency"], "as_of": latest,
            "advances": sum(1 for r in fresh if r["change_pct"] > 0),
            "declines": sum(1 for r in fresh if r["change_pct"] < 0), "scanned": len(rows), "categories": out}


def _passes(r: dict, flt: dict) -> bool:
    def ok(field, lo=None, hi=None):
        v = r.get(field)
        if lo is None and hi is None:
            return True
        if v is None:
            return False
        return (lo is None or v >= lo) and (hi is None or v <= hi)

    return all([
        ok("price", flt.get("min_price"), flt.get("max_price")),
        ok("avg_volume", flt.get("min_volume")),
        ok("volume_surge", flt.get("min_volume_surge")),
        ok("buying_pressure", flt.get("min_buying_pressure")),
        ok("return_1m", flt.get("min_return_1m")),
        ok("return_3m", flt.get("min_return_3m")),
        ok("profit_margin", flt.get("min_profit_margin")),
        ok("pe", None, flt.get("max_pe")),
        ok("market_cap", flt.get("min_market_cap")),
        (not flt.get("sector")) or r.get("sector") == flt["sector"],
    ])


def suggest(universe: str, sort: str = "score", limit: int = 25, **flt) -> dict:
    rows = scan(universe)
    field = SORT_FIELDS.get(sort, "score")
    filtered = [r for r in rows if _passes(r, flt)]
    ascending = field == "pe"
    filtered.sort(key=lambda r: (r.get(field) is None, (r.get(field) or 0) * (1 if ascending else -1)))
    return {
        "universe": universe,
        "label": UNIVERSES[universe]["label"],
        "currency": UNIVERSES[universe]["currency"],
        "scanned": len(rows),
        "matched": len(filtered),
        "sectors": sorted({r["sector"] for r in rows if r.get("sector")}),
        "latest": max((r["as_of"] for r in rows), default=None),
        "results": filtered[:limit],
    }
