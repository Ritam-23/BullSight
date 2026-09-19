"""Company news and corporate events (earnings, dividends, splits) from Yahoo Finance."""
import re
import threading
import time
from datetime import date, datetime, timezone

import pandas as pd
import yfinance as yf

import market
import symbols

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
TTL = 30 * 60

# Tags like "(NYSE:RS)", "(NASDAQ: AAPL)", "(BOM:532493)", "(NSE:HAL)" name the company an article is about.
_TICKER_TAG = re.compile(r"\((?:NYSE|NASDAQ|NSE|BOM|BSE|AMEX|OTC)\s*:\s*([A-Z0-9.\-&]+)\)", re.I)
_STOP = {"ltd", "limited", "inc", "corp", "corporation", "company", "co", "the", "and", "of", "india", "plc",
         "class", "common", "stock", "shares", "group", "holdings", "industries", "technologies"}


def _name_words(name: str) -> list[str]:
    words = [w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in _STOP and len(w) > 2]
    return words[:2]


def _relevance(text: str, base: str, alt_codes: set[str], words: list[str]) -> str:
    """'direct' if the article is about this company, 'related' otherwise."""
    tags = {t.upper() for t in _TICKER_TAG.findall(text)}
    if tags:
        return "direct" if tags & ({base} | alt_codes) else "related"
    low = text.lower()
    if re.search(rf"\b{re.escape(base.lower())}\b", low) or (words and all(w in low for w in words)):
        return "direct"
    return "related"


def _ts(v) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (datetime, pd.Timestamp)):
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(f) else f


def get(symbol: str) -> dict:
    key = symbol.upper()
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]

    # BSE lines use the NSE twin: Yahoo carries news/events on the NSE listing.
    source = market.nse_twin(key) or key
    t = yf.Ticker(source)
    meta = symbols.lookup(key) or {}
    base = source.split(".")[0].upper()
    alt = {str(meta.get("alt", "")).split(".")[0].upper()} - {""}
    words = _name_words(meta.get("name", ""))

    news = []
    try:
        raw_news = t.news or []
    except Exception:  # noqa: BLE001
        raw_news = []
    for item in raw_news:
        c = item.get("content", item)
        title = c.get("title")
        if not title:
            continue
        url = (c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
        thumb = None
        res = (c.get("thumbnail") or {}).get("resolutions") or []
        if res:
            thumb = min(res, key=lambda r: abs((r.get("width") or 0) - 240)).get("url")
        summary = re.sub(r"<[^>]+>", "", c.get("summary") or c.get("description") or "").strip()
        news.append({
            "title": title, "summary": summary[:300], "url": url, "thumbnail": thumb,
            "publisher": (c.get("provider") or {}).get("displayName"), "published": c.get("pubDate") or c.get("displayTime"),
            "type": (c.get("contentType") or "STORY").lower(),
            "relevance": _relevance(f"{title} {summary}", base, alt, words),
        })
    news.sort(key=lambda n: (n["relevance"] != "direct", -(pd.Timestamp(n["published"]).timestamp() if n["published"] else 0)))

    today = datetime.now(timezone.utc).date()
    upcoming = []
    try:
        cal = t.calendar or {}
    except Exception:  # noqa: BLE001
        cal = {}
    earnings = cal.get("Earnings Date") or []
    if earnings:
        upcoming.append({"type": "earnings", "date": _ts(earnings[0]), "title": "Quarterly results",
                         "detail": {"eps_estimate": _num(cal.get("Earnings Average")), "eps_low": _num(cal.get("Earnings Low")),
                                    "eps_high": _num(cal.get("Earnings High")), "revenue_estimate": _num(cal.get("Revenue Average"))}})
    if cal.get("Ex-Dividend Date"):
        upcoming.append({"type": "ex_dividend", "date": _ts(cal["Ex-Dividend Date"]), "title": "Ex-dividend date", "detail": {}})
    if cal.get("Dividend Date"):
        upcoming.append({"type": "dividend", "date": _ts(cal["Dividend Date"]), "title": "Dividend payment", "detail": {}})
    for e in upcoming:
        e["days_away"] = (date.fromisoformat(e["date"]) - today).days if e["date"] else None
    upcoming.sort(key=lambda e: e["date"] or "")

    earnings_hist = []
    try:
        ed = t.get_earnings_dates(limit=8)
    except Exception:  # noqa: BLE001
        ed = None
    if ed is not None and not ed.empty:
        for when, row in ed.iterrows():
            earnings_hist.append({"date": _ts(when), "eps_estimate": _num(row.get("EPS Estimate")),
                                  "eps_reported": _num(row.get("Reported EPS")), "surprise_pct": _num(row.get("Surprise(%)"))})

    def series(s: pd.Series, n: int) -> list[dict]:
        if s is None or s.empty:
            return []
        return [{"date": _ts(k), "value": float(v)} for k, v in s.tail(n).iloc[::-1].items()]

    try:
        dividends, splits = series(t.dividends, 10), series(t.splits, 10)
    except Exception:  # noqa: BLE001
        dividends, splits = [], []

    result = {"symbol": key, "source": source, "news": news, "upcoming": upcoming, "earnings": earnings_hist,
              "dividends": dividends, "splits": splits, "currency": meta.get("currency")}
    with _lock:
        _cache[key] = (time.time(), result)
    return result
