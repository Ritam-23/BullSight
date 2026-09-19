"""Sectors and themes (Defence, Energy, Banking, ...) for sector search and sector pages.

India: NSE's thematic/sectoral index lists plus the industry tags of the NIFTY Total Market (750 stocks).
US: GICS sectors and sub-industries of the S&P 500. Cached on disk for a week.
"""
import io
import json
import re
import threading
import time

import pandas as pd

import config
import symbols

SECTORS_FILE = config.DATA_DIR / "sectors_v1.json"
MAX_AGE = 7 * 24 * 3600
_NSE = "https://archives.nseindia.com/content/indices/ind_{}.csv"

# slug -> (display name, NSE index file, extra search keywords)
INDIA_THEMES = {
    "defence": ("Defence", "niftyindiadefence_list", "defense military aerospace shipbuilding missile"),
    "energy": ("Energy", "niftyenergylist", "power renewable electricity"),
    "banking": ("Banking", "niftybanklist", "bank banks lender"),
    "psu-banks": ("PSU Banks", "niftypsubanklist", "public sector bank government bank"),
    "it": ("IT & Software", "niftyitlist", "tech technology software information"),
    "pharma": ("Pharma", "niftypharmalist", "pharmaceutical medicine drugs"),
    "healthcare": ("Healthcare", "niftyhealthcarelist", "hospital health medical"),
    "auto": ("Automobile", "niftyautolist", "auto car vehicle ev automobile"),
    "fmcg": ("FMCG", "niftyfmcglist", "consumer goods staples fast moving"),
    "metals": ("Metals & Mining", "niftymetallist", "metal steel mining aluminium copper"),
    "realty": ("Real Estate", "niftyrealtylist", "realty property housing"),
    "media": ("Media & Entertainment", "niftymedialist", "entertainment broadcasting"),
    "oil-gas": ("Oil & Gas", "niftyoilgaslist", "oil gas petroleum refinery"),
    "consumer-durables": ("Consumer Durables", "niftyconsumerdurableslist", "appliances electronics durables"),
    "financial-services": ("Financial Services", "niftyfinancelist", "finance nbfc insurance"),
    "infrastructure": ("Infrastructure", "niftyinfralist", "infra construction cement"),
    "commodities": ("Commodities", "niftycommoditieslist", "commodity"),
    "psu": ("PSU / Government companies", "niftypselist", "pse government public sector"),
}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _read_nse(name: str) -> pd.DataFrame:
    text = symbols._get(_NSE.format(name)).text
    return pd.read_csv(io.StringIO(text))


def _build() -> dict:
    out: dict[str, dict] = {}

    def add(slug, name, region, source, syms, keywords=""):
        syms = [s for s in dict.fromkeys(syms) if symbols.lookup(s)]
        if not syms:
            return
        if slug in out:
            out[slug]["symbols"] = list(dict.fromkeys(out[slug]["symbols"] + syms))
            return
        out[slug] = {"slug": slug, "name": name, "region": region, "source": source, "symbols": syms,
                     "keywords": f"{name} {keywords}".lower()}

    for slug, (name, file, kw) in INDIA_THEMES.items():
        try:
            df = _read_nse(file)
            add(slug, name, "IN", f"NIFTY {name} index", [f"{s.strip()}.NS" for s in df["Symbol"]], kw)
        except Exception as e:  # noqa: BLE001
            print(f"sector list {file} unavailable:", e)
    try:
        tm = _read_nse("niftytotalmarket_list")
        for industry, grp in tm.groupby("Industry"):
            slug = "in-" + _slug(industry)
            add(slug, f"{industry} (India)", "IN", "NSE industry classification",
                [f"{s.strip()}.NS" for s in grp["Symbol"]])
    except Exception as e:  # noqa: BLE001
        print("NIFTY Total Market list unavailable:", e)
    try:
        sp = pd.read_csv(io.StringIO(symbols._get(
            "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv").text))
        for col, source, prefix in (("GICS Sector", "GICS sector (S&P 500)", "us-"),
                                    ("GICS Sub-Industry", "GICS sub-industry (S&P 500)", "us-sub-")):
            for label, grp in sp.groupby(col):
                aliases = "defense defence military" if "Defense" in label else "tech technology" if "Technology" in label else ""
                add(prefix + _slug(label), f"{label} (US)", "US", source,
                    [symbols._yahoo_us(s) for s in grp["Symbol"].astype(str)], aliases)
    except Exception as e:  # noqa: BLE001
        print("S&P 500 sectors unavailable:", e)
    return out


_lock = threading.Lock()
_sectors: dict[str, dict] | None = None
_by_symbol: dict[str, list[str]] = {}


def _load() -> dict[str, dict]:
    global _sectors, _by_symbol
    with _lock:
        if _sectors is None:
            if SECTORS_FILE.exists() and time.time() - SECTORS_FILE.stat().st_mtime < MAX_AGE:
                data = json.loads(SECTORS_FILE.read_text())
            else:
                data = _build()
                if data:
                    SECTORS_FILE.write_text(json.dumps(data))
                elif SECTORS_FILE.exists():
                    data = json.loads(SECTORS_FILE.read_text())
            _sectors = data
            idx: dict[str, list[str]] = {}
            for slug, sec in data.items():
                for s in sec["symbols"]:
                    idx.setdefault(s, []).append(slug)
            _by_symbol = idx
        return _sectors


def get(slug: str) -> dict | None:
    return _load().get(slug)


def for_symbol(symbol: str) -> list[dict]:
    _load()
    sym = symbol.upper()
    if sym.endswith(".BO"):
        sym = sym[:-3] + ".NS"  # BSE twins share the NSE listing's sector
    return [{"slug": s, "name": _sectors[s]["name"]} for s in _by_symbol.get(sym, [])]  # type: ignore[index]


def search(query: str, limit: int = 4) -> list[dict]:
    """Sectors whose name or keywords contain a word starting with the query (min 3 letters)."""
    q = query.strip().lower()
    if len(q) < 3:
        return []
    hits = []
    for sec in _load().values():
        words = re.findall(r"[a-z0-9&]+", sec["keywords"])
        if any(w.startswith(q) for w in words) or sec["keywords"].startswith(q):
            # Curated themes first, then broad sectors, then narrow sub-industries.
            rank = 0 if sec["source"].startswith("NIFTY") else 1 if "sub-industry" not in sec["source"] else 2
            hits.append((rank, -len(sec["symbols"]), sec))
    hits.sort(key=lambda t: (t[0], t[1]))
    return [{"slug": s["slug"], "name": s["name"], "region": s["region"], "count": len(s["symbols"]),
             "source": s["source"]} for _, _, s in hits[:limit]]


def stocks_matching(query: str, limit: int = 8) -> list[str]:
    """Symbols belonging to sectors that match the query (used to enrich stock search results)."""
    out: list[str] = []
    for hit in search(query, limit=2):
        out += _load()[hit["slug"]]["symbols"]
    return list(dict.fromkeys(out))[:limit]
