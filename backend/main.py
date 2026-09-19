import math
import threading

import pandas as pd

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

import analytics
import config
import logos
import market
import model
import news
import scalper
import screener
import sectors
import symbols
from auth import require_user
from auth import router as auth_router
from portfolio import router as portfolio_router
from profiles import router as profiles_router

app = FastAPI(title="StockSight API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(portfolio_router)
app.include_router(profiles_router)


@app.on_event("startup")
def _warm():
    # Download listings and pre-scan the default movers universes so the dashboard opens fast.
    def warm():
        symbols.all_listings()
        sectors.search("warm")
        for u in ("NIFTY50", "NASDAQ"):
            try:
                screener.scan(u)
            except Exception as e:  # noqa: BLE001
                print(f"warm-up scan {u} failed:", e)

    threading.Thread(target=warm, daemon=True).start()


def _safe(obj):
    """Replace NaN/inf (not valid JSON) with None, recursively."""
    if isinstance(obj, float):
        return None if math.isnan(obj) or math.isinf(obj) else obj
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe(v) for v in obj]
    return obj


@app.get("/api/health")
def health():
    return {"status": "online"}


@app.get("/api/markets")
def markets_endpoint(_user=Depends(require_user)):
    return markets()


def markets():
    """Headline indices: NIFTY 50, SENSEX, S&P 500, NASDAQ, plus gold and silver."""
    meta = {i["symbol"]: i for i in symbols.INDICES}
    tickers = ["^NSEI", "^BSESN", "^GSPC", "^IXIC", "GC=F", "SI=F"]
    return _safe([{**q, "name": meta[q["symbol"]]["name"], "currency": meta[q["symbol"]]["currency"]}
                  for q in market.quotes(tickers)])


METALS = ["GC=F", "SI=F", "GOLDBEES.NS", "SILVERBEES.NS", "GLD", "SLV"]


@app.get("/api/metals")
def metals(_user=Depends(require_user)):
    """Gold and silver: COMEX futures plus the largest Indian and US ETFs."""
    names = {"GC=F": "Gold futures", "SI=F": "Silver futures", "GOLDBEES.NS": "Nippon Gold BeES",
             "SILVERBEES.NS": "Nippon Silver BeES", "GLD": "SPDR Gold Shares", "SLV": "iShares Silver Trust"}
    return _safe([{**q, "name": names[q["symbol"]], "currency": "INR" if q["symbol"].endswith(".NS") else "USD"}
                  for q in market.quotes(METALS)])


@app.get("/api/chart/{symbol}")
def chart(symbol: str, range: str = "6M", _user=Depends(require_user)):  # noqa: A002
    try:
        data = analytics.chart(symbol.upper(), range)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if data is None:
        raise HTTPException(404, f"No chart data for {symbol} ({range})")
    return _safe(data)


@app.get("/api/analytics/{symbol}")
def stock_analytics(symbol: str, _user=Depends(require_user)):
    data = analytics.analytics(symbol.upper())
    if data is None:
        raise HTTPException(404, f"Not enough history for {symbol}")
    return _safe(data)


@app.get("/api/movers")
def movers(universe: str = "NIFTY50", limit: int = Query(8, le=25), _user=Depends(require_user)):
    try:
        return _safe(screener.movers(universe, limit))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/logo/{symbol}")
def logo(symbol: str):
    """Company logo as PNG (public: logos are public brand assets). 404 = show a letter badge instead."""
    data = logos.get(symbol)
    if data is None:
        return Response(status_code=404, headers={"Cache-Control": "public, max-age=86400"})
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/public/markets")
def public_markets():
    """Index snapshot for the signed-out landing page (public market data only)."""
    return markets()


@app.get("/api/exchanges")
def exchanges(_user=Depends(require_user)):
    return {"counts": symbols.counts(),
            "universes": [{"id": k, **v} for k, v in screener.UNIVERSES.items()]}


@app.get("/api/search")
def search(q: str = Query(..., min_length=1), exchange: str | None = None, limit: int = 15,
           _user=Depends(require_user)):
    """Stocks matching the query by symbol/name, plus sectors ("defence", "energy") and their stocks."""
    limit = min(limit, 50)
    stocks = symbols.search(q, exchange, limit)
    matched_sectors = sectors.search(q)
    seen = {s["symbol"] for s in stocks}
    for sym in sectors.stocks_matching(q):
        meta = symbols.lookup(sym)
        if meta and sym not in seen and (not exchange or meta["exchange"].upper() == exchange.upper()):
            stocks.append({k: meta.get(k) for k in ("symbol", "name", "exchange", "country", "currency", "type")}
                          | {"via_sector": True})
            seen.add(sym)
    return {"stocks": stocks[: limit + 8], "sectors": matched_sectors}


@app.get("/api/sector/{slug}")
def sector(slug: str, _user=Depends(require_user)):
    sec = sectors.get(slug)
    if not sec:
        raise HTTPException(404, "Unknown sector")
    data = market.batch_history(sec["symbols"], period="1y")
    rows = []
    for sym in sec["symbols"]:
        df = data.get(sym)
        meta = symbols.lookup(sym) or {}
        if df is None or len(df) < 2:
            continue
        c = df["Close"]
        past = lambda off: c[c.index <= c.index[-1] - off]  # noqa: E731
        m1, y1 = past(pd.DateOffset(months=1)), past(pd.DateOffset(years=1))
        rows.append({"symbol": sym, "name": meta.get("name", sym), "price": float(c.iloc[-1]),
                     "change_pct": float(c.iloc[-1] / c.iloc[-2] - 1) * 100,
                     "return_1m": float(c.iloc[-1] / m1.iloc[-1] - 1) * 100 if len(m1) else None,
                     "return_1y": float(c.iloc[-1] / y1.iloc[-1] - 1) * 100 if len(y1) else None,
                     "volume": float(df["Volume"].iloc[-1]), "spark": [round(float(x), 2) for x in c.tail(30)]})
    rows.sort(key=lambda r: r["change_pct"], reverse=True)
    avg = sum(r["change_pct"] for r in rows) / len(rows) if rows else None
    return _safe({"slug": slug, "name": sec["name"], "region": sec["region"], "source": sec["source"],
                  "currency": "INR" if sec["region"] == "IN" else "USD", "avg_change_pct": avg,
                  "advances": sum(r["change_pct"] > 0 for r in rows), "declines": sum(r["change_pct"] < 0 for r in rows),
                  "stocks": rows})


@app.get("/api/news/{symbol}")
def stock_news(symbol: str, _user=Depends(require_user)):
    """Headlines plus upcoming earnings/dividend dates and past earnings, dividends and splits."""
    return _safe(news.get(symbol.upper()))


@app.get("/api/scalp/{symbol}")
def scalp(symbol: str, interval: str = "1m", _user=Depends(require_user)):
    try:
        data = scalper.scalp(symbol.upper(), interval)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if data is None:
        raise HTTPException(404, f"No intraday data for {symbol}")
    return _safe(data)


@app.get("/api/sectors/for/{symbol}")
def sectors_for(symbol: str, _user=Depends(require_user)):
    return sectors.for_symbol(symbol)


@app.get("/api/stock/{symbol}")
def stock(symbol: str, _user=Depends(require_user)):
    symbol = symbol.upper()
    meta = symbols.lookup(symbol) or {"symbol": symbol, "name": symbol, "exchange": "", "currency": None}
    df = market.history(symbol, period="1y")
    if df is None:
        raise HTTPException(404, f"No market data found for {symbol}")
    info = {} if meta.get("type") == "INDEX" else market.fundamentals([symbol]).get(symbol, {})
    c = df["Close"]
    return _safe({
        "symbol": symbol,
        "name": info.get("long_name") or info.get("name") or meta.get("name"),
        "exchange": meta.get("exchange"),
        "currency": info.get("currency") or meta.get("currency"),
        "type": meta.get("type", "EQUITY"),
        "price": float(c.iloc[-1]),
        "change": float(c.iloc[-1] - c.iloc[-2]),
        "change_pct": float((c.iloc[-1] / c.iloc[-2] - 1) * 100),
        "volume": float(df["Volume"].iloc[-1]),
        "as_of": df.index[-1].strftime("%Y-%m-%d"),
        "data_source": df.attrs.get("source_symbol", symbol),
        "fundamentals": {k: v for k, v in info.items() if k not in ("name", "long_name", "currency")},
    })


@app.get("/api/predict/{symbol}")
def predict(symbol: str, _user=Depends(require_user)):
    symbol = symbol.upper()
    df = market.history(symbol, period="5y")
    if df is None:
        raise HTTPException(404, f"No market data found for {symbol}")
    try:
        return _safe({**model.forecast(symbol, df), "data_source": df.attrs.get("source_symbol", symbol)})
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.get("/api/suggest")
def suggest(
    universe: str = "NIFTY50",
    sort: str = "score",
    limit: int = Query(25, le=100),
    min_price: float | None = None,
    max_price: float | None = None,
    min_volume: float | None = None,
    min_volume_surge: float | None = None,
    min_buying_pressure: float | None = None,
    min_return_1m: float | None = None,
    min_return_3m: float | None = None,
    min_profit_margin: float | None = None,
    max_pe: float | None = None,
    min_market_cap: float | None = None,
    sector: str | None = None,
    _user=Depends(require_user),
):
    try:
        return _safe(screener.suggest(
            universe, sort, limit, min_price=min_price, max_price=max_price, min_volume=min_volume,
            min_volume_surge=min_volume_surge, min_buying_pressure=min_buying_pressure,
            min_return_1m=min_return_1m, min_return_3m=min_return_3m, min_profit_margin=min_profit_margin,
            max_pe=max_pe, min_market_cap=min_market_cap, sector=sector))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
