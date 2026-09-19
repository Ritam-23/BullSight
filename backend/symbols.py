"""Exchange listings (NASDAQ, NYSE, BSE, NSE), index constituents, and symbol search.

Listings are downloaded from the exchanges' own public files and cached on disk for a week.
"""
import io
import json
import threading
import time

import pandas as pd
import requests

import config

# Bump the suffix when the listing format changes so stale caches are rebuilt.
LISTINGS_FILE = config.DATA_DIR / "listings_v3.json"
CONSTITUENTS_FILE = config.DATA_DIR / "constituents_v3.json"
MAX_AGE = 7 * 24 * 3600

INDICES = [
    {"symbol": "^NSEI", "name": "NIFTY 50", "exchange": "INDEX", "country": "IN", "currency": "INR"},
    {"symbol": "^BSESN", "name": "S&P BSE SENSEX", "exchange": "INDEX", "country": "IN", "currency": "INR"},
    {"symbol": "^GSPC", "name": "S&P 500", "exchange": "INDEX", "country": "US", "currency": "USD"},
    {"symbol": "^IXIC", "name": "NASDAQ Composite", "exchange": "INDEX", "country": "US", "currency": "USD"},
    {"symbol": "^NDX", "name": "NASDAQ-100", "exchange": "INDEX", "country": "US", "currency": "USD"},
    {"symbol": "^DJI", "name": "Dow Jones Industrial Average", "exchange": "INDEX", "country": "US", "currency": "USD"},
    {"symbol": "^NSEBANK", "name": "NIFTY Bank", "exchange": "INDEX", "country": "IN", "currency": "INR"},
    {"symbol": "GC=F", "name": "Gold futures (COMEX, USD/oz)", "exchange": "COMMODITY", "country": "US", "currency": "USD"},
    {"symbol": "SI=F", "name": "Silver futures (COMEX, USD/oz)", "exchange": "COMMODITY", "country": "US", "currency": "USD"},
]

# US-listed physically backed gold and silver ETFs.
US_METAL_ETFS = ["GLD", "IAU", "GLDM", "SGOL", "AAAU", "BAR", "SLV", "SIVR", "PSLV"]
_METAL_WORDS = ("GOLD", "SILVER", "SLVR", "SILV")

_US_EXCHANGE_CODES = {"N": "NYSE", "A": "NYSE American", "P": "NYSE Arca", "Z": "Cboe BZX", "V": "IEX"}
_lock = threading.Lock()
_listings: list[dict] | None = None
_by_symbol: dict[str, dict] = {}
_constituents: dict[str, list[str]] | None = None


def _get(url: str, **kw) -> requests.Response:
    headers = {**config.HTTP_HEADERS, **kw.pop("headers", {})}
    r = requests.get(url, headers=headers, timeout=kw.pop("timeout", 30), **kw)
    r.raise_for_status()
    return r


def _yahoo_us(sym: str) -> str:
    # Exchange files use '.' or '$' for share classes/preferreds; Yahoo uses '-'.
    return sym.replace(".", "-").replace("$", "-P")


def _fetch_nasdaq() -> list[dict]:
    lines = _get("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt").text.splitlines()
    out = []
    for line in lines[1:]:
        parts = line.split("|")
        if len(parts) < 8 or line.startswith("File Creation"):
            continue
        sym, name, _cat, test, _fin, _lot, etf, _ = parts[:8]
        if test == "Y":
            continue
        out.append({"symbol": _yahoo_us(sym), "name": name, "exchange": "NASDAQ", "country": "US",
                    "currency": "USD", "type": "ETF" if etf == "Y" else "EQUITY"})
    return out


def _fetch_other_us() -> list[dict]:
    lines = _get("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt").text.splitlines()
    out = []
    for line in lines[1:]:
        parts = line.split("|")
        if len(parts) < 8 or line.startswith("File Creation"):
            continue
        sym, name, exch, _cqs, etf, _lot, test, _ = parts[:8]
        if test == "Y":
            continue
        out.append({"symbol": _yahoo_us(sym), "name": name, "exchange": _US_EXCHANGE_CODES.get(exch, exch),
                    "country": "US", "currency": "USD", "type": "ETF" if etf == "Y" else "EQUITY"})
    return out


def _fetch_bse() -> list[dict]:
    url = ("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
           "?Group=&Scripcode=&industry=&segment=Equity&status=Active")
    data = _get(url, headers={"Referer": "https://www.bseindia.com/"}).json()
    out = []
    for row in data:
        sid = (row.get("scrip_id") or "").strip()
        code = (row.get("SCRIP_CD") or "").strip()
        if not code:
            continue
        try:
            mcap = float(row.get("Mktcap") or 0)
        except ValueError:
            mcap = 0.0
        out.append({"symbol": f"{sid or code}.BO", "alt": f"{code}.BO", "name": row.get("Scrip_Name") or sid,
                    "exchange": "BSE", "country": "IN", "currency": "INR", "type": "EQUITY",
                    "group": row.get("GROUP"), "mcap_cr": mcap, "isin": (row.get("ISIN_NUMBER") or "").strip() or None})
    return out


def _fetch_bse_etfs() -> list[dict]:
    """ETFs trade in BSE's 'MF' segment. Nearly all are dual-listed on NSE under the same symbol,
    so each one is added for both exchanges."""
    url = ("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
           "?Group=&Scripcode=&industry=&segment=MF&status=Active")
    data = _get(url, headers={"Referer": "https://www.bseindia.com/"}).json()
    out = []
    for row in data:
        sid = (row.get("scrip_id") or "").strip()
        name = (row.get("Scrip_Name") or sid).strip()
        if not sid or not ("ETF" in name.upper() or "BEES" in sid.upper() or "EXCHANGE TRADED" in name.upper()):
            continue
        metal = any(w in (sid + name).upper() for w in _METAL_WORDS)
        base = {"name": name, "country": "IN", "currency": "INR", "type": "ETF", "metal": metal,
                "isin": (row.get("ISIN_NUMBER") or "").strip() or None}
        out.append({**base, "symbol": f"{sid}.BO", "alt": f"{row.get('SCRIP_CD')}.BO", "exchange": "BSE"})
        out.append({**base, "symbol": f"{sid}.NS", "exchange": "NSE"})
    return out


def _fetch_nse() -> list[dict]:
    text = _get("https://archives.nseindia.com/content/equities/EQUITY_L.csv").text
    df = pd.read_csv(io.StringIO(text))
    df.columns = [c.strip() for c in df.columns]
    return [{"symbol": f"{r['SYMBOL'].strip()}.NS", "name": r["NAME OF COMPANY"].strip(), "exchange": "NSE",
             "country": "IN", "currency": "INR", "type": "EQUITY", "isin": str(r.get("ISIN NUMBER", "")).strip() or None}
            for _, r in df.iterrows()]


def _fetch_constituents(listings: list[dict]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    try:
        sp = pd.read_csv(io.StringIO(_get(
            "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv").text))
        result["SP500"] = [_yahoo_us(s) for s in sp["Symbol"].astype(str)]
    except Exception as e:  # noqa: BLE001
        print("S&P 500 constituents unavailable:", e)
    try:
        n50 = pd.read_csv(io.StringIO(_get("https://archives.nseindia.com/content/indices/ind_nifty50list.csv").text))
        result["NIFTY50"] = [f"{s.strip()}.NS" for s in n50["Symbol"]]
    except Exception as e:  # noqa: BLE001
        print("NIFTY 50 constituents unavailable:", e)
    try:
        tables = pd.read_html(io.StringIO(_get("https://en.wikipedia.org/wiki/BSE_SENSEX").text))
        table = next(t for t in tables if "Symbol" in t.columns and len(t) >= 25)
        result["SENSEX"] = [str(s).strip() for s in table["Symbol"] if str(s).endswith(".BO")]
    except Exception as e:  # noqa: BLE001
        print("SENSEX constituents unavailable:", e)

    nasdaq_syms = {x["symbol"] for x in listings if x["exchange"] == "NASDAQ"}
    if "SP500" in result:
        # Large-cap NASDAQ universe: S&P 500 members that list on NASDAQ.
        result["NASDAQ"] = [s for s in result["SP500"] if s in nasdaq_syms]
    bse = sorted((x for x in listings if x["exchange"] == "BSE" and x.get("type") == "EQUITY"),
                 key=lambda x: x.get("mcap_cr", 0), reverse=True)
    # BSE universe: the 150 largest listed companies by market cap.
    result["BSE"] = [x["symbol"] for x in bse[:150]]
    # Gold & silver: Indian ETFs use their NSE line (Yahoo's BSE ETF history is patchy).
    result["GOLD_SILVER_IN"] = [x["symbol"] for x in listings
                                if x.get("metal") and x["exchange"] == "NSE" and x.get("type") == "ETF"]
    us_syms = {x["symbol"] for x in listings if x["country"] == "US"}
    result["GOLD_SILVER_US"] = [s for s in US_METAL_ETFS if s in us_syms]
    return result


def _fresh(path) -> bool:
    return path.exists() and time.time() - path.stat().st_mtime < MAX_AGE


def _load():
    global _listings, _by_symbol, _constituents
    with _lock:
        if _listings is not None:
            return
        if _fresh(LISTINGS_FILE) and _fresh(CONSTITUENTS_FILE):
            listings = json.loads(LISTINGS_FILE.read_text())
            constituents = json.loads(CONSTITUENTS_FILE.read_text())
        else:
            listings = [dict(i, type="INDEX") for i in INDICES]
            for name, fn in [("NASDAQ", _fetch_nasdaq), ("NYSE/other US", _fetch_other_us),
                             ("BSE", _fetch_bse), ("NSE", _fetch_nse), ("BSE/NSE ETFs", _fetch_bse_etfs)]:
                try:
                    listings += fn()
                except Exception as e:  # noqa: BLE001
                    print(f"{name} listing unavailable:", e)
            seen: set[str] = set()
            listings = [x for x in listings if not (x["symbol"] in seen or seen.add(x["symbol"]))]
            if len(listings) <= len(INDICES) and LISTINGS_FILE.exists():
                listings = json.loads(LISTINGS_FILE.read_text())  # offline: keep stale copy
            else:
                LISTINGS_FILE.write_text(json.dumps(listings))
            constituents = _fetch_constituents(listings)
            if constituents:
                CONSTITUENTS_FILE.write_text(json.dumps(constituents))
            elif CONSTITUENTS_FILE.exists():
                constituents = json.loads(CONSTITUENTS_FILE.read_text())
        _listings = listings
        _by_symbol = {x["symbol"].upper(): x for x in listings}
        _constituents = constituents


def all_listings() -> list[dict]:
    _load()
    return _listings  # type: ignore[return-value]


def lookup(symbol: str) -> dict | None:
    _load()
    return _by_symbol.get(symbol.upper())


def constituents(universe: str) -> list[str]:
    _load()
    return list((_constituents or {}).get(universe.upper(), []))


def counts() -> dict[str, int]:
    _load()
    c: dict[str, int] = {}
    for x in _listings or []:
        c[x["exchange"]] = c.get(x["exchange"], 0) + 1
    return c


def search(query: str, exchange: str | None = None, limit: int = 15) -> list[dict]:
    _load()
    q = query.strip().upper()
    if not q:
        return []
    ex = exchange.upper() if exchange else None
    scored = []
    for x in _listings or []:
        if ex and x["exchange"].upper() != ex:
            continue
        sym = x["symbol"].upper()
        base = sym.split(".")[0]
        name = x["name"].upper()
        if sym == q or base == q:
            score = 0
        elif base.startswith(q):
            score = 1 + len(base) / 100
        elif name.startswith(q):
            score = 2 + len(name) / 1000
        elif q in name:
            score = 3 + len(name) / 1000
        else:
            continue
        # Prefer indices and common stock over ETFs at equal relevance.
        score += {"INDEX": -1.5, "EQUITY": 0, "ETF": 0.1}.get(x.get("type", "EQUITY"), 0)
        scored.append((score, x))
    scored.sort(key=lambda t: t[0])
    return [{k: v for k, v in x.items() if k in ("symbol", "name", "exchange", "country", "currency", "type")}
            for _, x in scored[:limit]]
