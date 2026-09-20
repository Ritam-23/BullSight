"""Paper trading: an INR wallet (top-ups via Stripe Checkout in test mode), market orders at live prices,
holdings with P&L, and a watchlist.

No real securities are bought or sold. Real trading requires a SEBI-registered broker (e.g. an order
API such as Zerodha Kite Connect or Upstox); replace `trade()` with a broker call to go live.
"""
import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import config
import market
import symbols
import users
from auth import require_user

router = APIRouter(prefix="/api", tags=["portfolio"])

MIN_TOPUP, MAX_TOPUP = 100, 1_000_000          # rupees per top-up
MAX_WALLET_PAISE = 10_000_000 * 100            # ₹1 crore cap on the paper wallet
MAX_WATCHLIST = 100

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS wallets (user_id TEXT PRIMARY KEY, balance_paise INTEGER NOT NULL DEFAULT 0)""",
    """CREATE TABLE IF NOT EXISTS transactions (
           id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL,
           amount_paise INTEGER NOT NULL, balance_after INTEGER NOT NULL, ref TEXT, created_at REAL NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS holdings (
           user_id TEXT NOT NULL, symbol TEXT NOT NULL, qty INTEGER NOT NULL, avg_price REAL NOT NULL,
           currency TEXT NOT NULL, invested_paise INTEGER NOT NULL, PRIMARY KEY (user_id, symbol))""",
    """CREATE TABLE IF NOT EXISTS orders (
           id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
           qty INTEGER NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL, fx REAL NOT NULL,
           amount_paise INTEGER NOT NULL, realized_pnl_paise INTEGER, created_at REAL NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS watchlist (
           user_id TEXT NOT NULL, symbol TEXT NOT NULL, added_at REAL NOT NULL, PRIMARY KEY (user_id, symbol))""",
    """CREATE TABLE IF NOT EXISTS payments (
           order_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount_paise INTEGER NOT NULL,
           status TEXT NOT NULL, payment_id TEXT, created_at REAL NOT NULL)""",
]


@contextmanager
def _Tx():
    """One committed transaction on the shared users database (rolled back on any exception)."""
    with users._lock, users._conn() as conn:
        for stmt in SCHEMA:
            conn.execute(stmt)
        yield conn


def _balance(conn, uid: str) -> int:
    row = conn.execute("SELECT balance_paise FROM wallets WHERE user_id = ?", (uid,)).fetchone()
    return row[0] if row else 0


def _move(conn, uid: str, kind: str, amount_paise: int, ref: str | None = None) -> int:
    bal = _balance(conn, uid) + amount_paise
    if bal < 0:
        raise HTTPException(400, "Insufficient wallet balance.")
    if bal > MAX_WALLET_PAISE:
        raise HTTPException(400, "Wallet limit is ₹1,00,00,000.")
    conn.execute("INSERT INTO wallets (user_id, balance_paise) VALUES (?, ?) "
                 "ON CONFLICT(user_id) DO UPDATE SET balance_paise = excluded.balance_paise", (uid, bal))
    conn.execute("INSERT INTO transactions (user_id, kind, amount_paise, balance_after, ref, created_at) "
                 "VALUES (?, ?, ?, ?, ?, ?)", (uid, kind, amount_paise, bal, ref, time.time()))
    return bal


# ---------------------------------------------------------------- quotes

def _tradeable(symbol: str) -> dict:
    meta = symbols.lookup(symbol)
    if not meta or meta.get("type") not in ("EQUITY", "ETF") or symbol.startswith("^") or "=" in symbol:
        raise HTTPException(400, "Only listed stocks and ETFs can be traded (not indices or futures).")
    return meta


def _quote(symbol: str) -> dict:
    meta = _tradeable(symbol)
    q = market.live_price(symbol)
    if not q:
        raise HTTPException(503, f"No live price for {symbol} right now.")
    currency = meta.get("currency", "INR")
    fx = 1.0 if currency == "INR" else market.usd_inr()
    return {"symbol": symbol, "name": meta.get("name"), "price": q["price"], "currency": currency, "fx": fx,
            "price_inr": q["price"] * fx, "change_pct": q["change_pct"], "source": q["source"]}


@router.get("/quote/{symbol}")
def quote(symbol: str, _user=Depends(require_user)):
    return _quote(symbol.upper())


# ---------------------------------------------------------------- trading

class TradeBody(BaseModel):
    symbol: str
    side: str = Field(pattern="^(buy|sell)$")
    qty: int = Field(gt=0, le=100_000)


@router.post("/trade")
def trade(body: TradeBody, user=Depends(require_user)):
    """Paper market order, filled at the live price fetched here (never a client-supplied price)."""
    uid, sym = user["id"], body.symbol.upper()
    q = _quote(sym)
    amount = round(q["price_inr"] * body.qty * 100)
    with _Tx() as conn:
        row = conn.execute("SELECT qty, avg_price, invested_paise FROM holdings WHERE user_id = ? AND symbol = ?",
                           (uid, sym)).fetchone()
        realized = None
        if body.side == "buy":
            bal = _move(conn, uid, "buy", -amount, f"{body.qty} × {sym}")
            old_qty, old_avg, old_inv = row or (0, 0.0, 0)
            new_qty = old_qty + body.qty
            new_avg = (old_avg * old_qty + q["price"] * body.qty) / new_qty
            conn.execute("INSERT INTO holdings (user_id, symbol, qty, avg_price, currency, invested_paise) "
                         "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, symbol) DO UPDATE SET "
                         "qty = excluded.qty, avg_price = excluded.avg_price, invested_paise = excluded.invested_paise",
                         (uid, sym, new_qty, new_avg, q["currency"], old_inv + amount))
        else:
            if not row or row[0] < body.qty:
                raise HTTPException(400, f"You hold {row[0] if row else 0} shares of {sym}.")
            old_qty, old_avg, old_inv = row
            cost = round(old_inv * body.qty / old_qty)
            realized = amount - cost
            bal = _move(conn, uid, "sell", amount, f"{body.qty} × {sym}")
            if old_qty == body.qty:
                conn.execute("DELETE FROM holdings WHERE user_id = ? AND symbol = ?", (uid, sym))
            else:
                conn.execute("UPDATE holdings SET qty = ?, invested_paise = ? WHERE user_id = ? AND symbol = ?",
                             (old_qty - body.qty, old_inv - cost, uid, sym))
        conn.execute("INSERT INTO orders (user_id, symbol, side, qty, price, currency, fx, amount_paise, "
                     "realized_pnl_paise, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (uid, sym, body.side, body.qty, q["price"], q["currency"], q["fx"], amount, realized, time.time()))
    return {"ok": True, "symbol": sym, "side": body.side, "qty": body.qty, "price": q["price"],
            "currency": q["currency"], "amount_inr": amount / 100, "balance_inr": bal / 100,
            "realized_pnl_inr": realized / 100 if realized is not None else None}


# ---------------------------------------------------------------- portfolio

@router.get("/portfolio")
def portfolio(user=Depends(require_user)):
    uid = user["id"]
    with _Tx() as conn:
        bal = _balance(conn, uid)
        rows = conn.execute("SELECT symbol, qty, avg_price, currency, invested_paise FROM holdings WHERE user_id = ? "
                            "ORDER BY symbol", (uid,)).fetchall()
        orders = conn.execute("SELECT symbol, side, qty, price, currency, amount_paise, realized_pnl_paise, created_at "
                              "FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50", (uid,)).fetchall()
        txs = conn.execute("SELECT kind, amount_paise, balance_after, ref, created_at FROM transactions "
                           "WHERE user_id = ? ORDER BY id DESC LIMIT 50", (uid,)).fetchall()
        realized_total = conn.execute("SELECT COALESCE(SUM(realized_pnl_paise), 0) FROM orders WHERE user_id = ?",
                                      (uid,)).fetchone()[0]

    fx = market.usd_inr() if any(r[3] != "INR" for r in rows) else 1.0
    with ThreadPoolExecutor(max_workers=8) as pool:
        live = dict(zip([r[0] for r in rows], pool.map(market.live_price, [r[0] for r in rows])))
    holdings, invested, current, day_pnl = [], 0, 0.0, 0.0
    for sym, qty, avg, cur, inv in rows:
        q = live.get(sym) or {}
        price = q.get("price") or avg
        rate = 1.0 if cur == "INR" else fx
        value = price * qty * rate
        prev = q.get("previous_close")
        day = (price - prev) * qty * rate if prev else 0.0
        invested += inv
        current += value
        day_pnl += day
        meta = symbols.lookup(sym) or {}
        holdings.append({"symbol": sym, "name": meta.get("name", sym), "qty": qty, "avg_price": avg, "currency": cur,
                         "price": price, "change_pct": q.get("change_pct"), "invested_inr": inv / 100,
                         "value_inr": value, "pnl_inr": value - inv / 100,
                         "pnl_pct": (value / (inv / 100) - 1) * 100 if inv else None, "day_pnl_inr": day})
    from profiles import with_avatar

    return {
        "user": with_avatar(user),
        "wallet": {"balance_inr": bal / 100},
        "summary": {"invested_inr": invested / 100, "current_inr": current, "pnl_inr": current - invested / 100,
                    "pnl_pct": (current / (invested / 100) - 1) * 100 if invested else None, "day_pnl_inr": day_pnl,
                    "realized_pnl_inr": realized_total / 100, "net_worth_inr": bal / 100 + current, "usd_inr": fx},
        "holdings": holdings,
        "orders": [{"symbol": o[0], "side": o[1], "qty": o[2], "price": o[3], "currency": o[4], "amount_inr": o[5] / 100,
                    "realized_pnl_inr": o[6] / 100 if o[6] is not None else None, "at": o[7]} for o in orders],
        "transactions": [{"kind": t[0], "amount_inr": t[1] / 100, "balance_inr": t[2] / 100, "ref": t[3], "at": t[4]}
                         for t in txs],
    }


# ---------------------------------------------------------------- order receipt

@router.get("/portfolio/last-order")
def last_order(user=Depends(require_user)):
    """The user's most recent order (buy OR sell), for the emailed receipt PDF. `order` is null
    if they have never traded."""
    with _Tx() as conn:
        row = conn.execute(
            "SELECT symbol, side, qty, price, currency, amount_paise, realized_pnl_paise, created_at "
            "FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user["id"],)
        ).fetchone()
    if not row:
        return {"order": None}
    sym, side, qty, price, currency, amount_paise, realized, created_at = row
    meta = symbols.lookup(sym) or {}
    return {
        "order": {
            "symbol": sym,
            "name": meta.get("name", sym),
            "exchange": meta.get("exchange", "—"),
            "side": side,
            "qty": qty,
            "price": price,
            "currency": currency,
            "amount_inr": amount_paise / 100,
            "realized_pnl_inr": realized / 100 if realized is not None else None,
            "at": created_at,
            "buyer_name": user.get("name"),
            "buyer_email": user.get("email"),
        }
    }


# ---------------------------------------------------------------- watchlist

@router.get("/watchlist")
def watchlist(user=Depends(require_user)):
    with _Tx() as conn:
        syms = [r[0] for r in conn.execute("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at DESC",
                                           (user["id"],)).fetchall()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        quotes = list(pool.map(market.live_price, syms))
    out = []
    for sym, q in zip(syms, quotes):
        meta = symbols.lookup(sym) or {}
        out.append({"symbol": sym, "name": meta.get("name", sym), "currency": meta.get("currency"),
                    "price": q["price"] if q else None, "change_pct": q["change_pct"] if q else None})
    return out


class WatchBody(BaseModel):
    symbol: str


@router.post("/watchlist")
def watch_add(body: WatchBody, user=Depends(require_user)):
    sym = body.symbol.upper()
    if not symbols.lookup(sym):
        raise HTTPException(404, f"Unknown symbol {sym}")
    with _Tx() as conn:
        n = conn.execute("SELECT COUNT(*) FROM watchlist WHERE user_id = ?", (user["id"],)).fetchone()[0]
        if n >= MAX_WATCHLIST:
            raise HTTPException(400, f"Watchlist is limited to {MAX_WATCHLIST} symbols.")
        conn.execute("INSERT OR IGNORE INTO watchlist (user_id, symbol, added_at) VALUES (?, ?, ?)",
                     (user["id"], sym, time.time()))
    return {"ok": True}


@router.delete("/watchlist/{symbol}")
def watch_remove(symbol: str, user=Depends(require_user)):
    with _Tx() as conn:
        conn.execute("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?", (user["id"], symbol.upper()))
    return {"ok": True}


@router.get("/watchlist/{symbol}")
def watch_status(symbol: str, user=Depends(require_user)):
    with _Tx() as conn:
        watched = conn.execute("SELECT 1 FROM watchlist WHERE user_id = ? AND symbol = ?",
                               (user["id"], symbol.upper())).fetchone() is not None
        held = conn.execute("SELECT qty FROM holdings WHERE user_id = ? AND symbol = ?",
                            (user["id"], symbol.upper())).fetchone()
        bal = _balance(conn, user["id"])
    return {"watched": watched, "held_qty": held[0] if held else 0, "balance_inr": bal / 100}


# ---------------------------------------------------------------- wallet top-ups (Stripe Checkout, test mode)

STRIPE_API = "https://api.stripe.com/v1"


def _stripe_mode() -> str:
    key = config.STRIPE_SECRET_KEY
    if not key:
        return "off"
    # Paper-trading wallet: only test-mode keys are accepted, so no real money is ever collected.
    return "test" if key.startswith(("sk_test_", "rk_test_")) else "live-blocked"


def _stripe(method: str, path: str, **kw) -> dict:
    r = requests.request(method, f"{STRIPE_API}{path}", auth=(config.STRIPE_SECRET_KEY, ""), timeout=20, **kw)
    body = r.json()
    if not r.ok:
        raise HTTPException(502, f"Stripe: {body.get('error', {}).get('message', 'request failed')}")
    return body


@router.get("/wallet/config")
def wallet_config(_user=Depends(require_user)):
    mode = _stripe_mode()
    return {"provider": "stripe", "mode": mode,
            "publishable_key": config.STRIPE_PUBLISHABLE_KEY if mode == "test" else None,
            "demo_credit": mode == "off", "min": MIN_TOPUP, "max": MAX_TOPUP}


class TopUpBody(BaseModel):
    amount: int = Field(ge=MIN_TOPUP, le=MAX_TOPUP)  # rupees


@router.post("/wallet/checkout")
def create_checkout(body: TopUpBody, user=Depends(require_user)):
    """Creates a Stripe Checkout Session; the browser is redirected to Stripe's hosted payment page."""
    mode = _stripe_mode()
    if mode == "live-blocked":
        raise HTTPException(400, "Live Stripe keys are disabled for this paper-trading wallet. Use sk_test_ keys.")
    if mode != "test":
        raise HTTPException(400, "Stripe is not configured.")
    back = f"{config.FRONTEND_URL}/profile"
    data = {
        "mode": "payment",
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": "inr",
        "line_items[0][price_data][unit_amount]": body.amount * 100,
        "line_items[0][price_data][product_data][name]": "BullSight paper-trading wallet top-up",
        "client_reference_id": user["id"],
        "metadata[user_id]": user["id"],
        "metadata[purpose]": "paper_wallet_topup",
        "success_url": f"{back}?topup=success&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{back}?topup=cancelled",
    }
    if user.get("email"):
        data["customer_email"] = user["email"]
    session = _stripe("POST", "/checkout/sessions", data=data)
    with _Tx() as conn:
        conn.execute("INSERT INTO payments (order_id, user_id, amount_paise, status, created_at) VALUES (?, ?, ?, ?, ?)",
                     (session["id"], user["id"], session["amount_total"], "created", time.time()))
    return {"url": session["url"], "session_id": session["id"]}


def _credit_session(session: dict, expected_user: str | None = None) -> int | None:
    """Credit the wallet for a paid Checkout Session exactly once. Returns the new balance (paise)."""
    sid = session["id"]
    with _Tx() as conn:
        row = conn.execute("SELECT user_id, amount_paise, status FROM payments WHERE order_id = ?", (sid,)).fetchone()
        if not row or (expected_user and row[0] != expected_user):
            raise HTTPException(404, "Unknown payment.")
        uid, amount, status = row
        mismatch = (session.get("client_reference_id") != uid or session.get("amount_total") != amount
                    or (session.get("currency") or "").lower() != "inr")
        if mismatch:
            raise HTTPException(400, "Payment details don't match this top-up.")
        if status == "paid":  # idempotent: webhook and redirect may both arrive
            return _balance(conn, uid)
        if session.get("payment_status") != "paid":
            return None
        conn.execute("UPDATE payments SET status = 'paid', payment_id = ? WHERE order_id = ?",
                     (session.get("payment_intent"), sid))
        return _move(conn, uid, "topup", amount, session.get("payment_intent") or sid)


class ConfirmBody(BaseModel):
    session_id: str = Field(pattern=r"^cs_(test|live)_[A-Za-z0-9]+$")


@router.post("/wallet/stripe/confirm")
def confirm_checkout(body: ConfirmBody, user=Depends(require_user)):
    """Called after Stripe redirects back: re-fetches the session from Stripe (never trusts the URL alone)."""
    if _stripe_mode() != "test":
        raise HTTPException(400, "Stripe is not configured.")
    session = _stripe("GET", f"/checkout/sessions/{body.session_id}")
    bal = _credit_session(session, expected_user=user["id"])
    if bal is None:
        return {"ok": False, "status": session.get("payment_status")}
    return {"ok": True, "amount_inr": session["amount_total"] / 100, "balance_inr": bal / 100}


def _verify_webhook(payload: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    """Stripe signature scheme: HMAC-SHA256 of "{t}.{payload}" must match a v1 signature."""
    ts, sigs = "", []
    for part in header.split(","):
        k, _, v = part.partition("=")
        if k == "t":
            ts = v
        elif k == "v1":
            sigs.append(v)
    if not ts.isdigit() or abs(time.time() - int(ts)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), ts.encode() + b"." + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)


@router.post("/wallet/stripe/webhook")
async def stripe_webhook(request: Request):
    """Optional: credits the wallet even if the browser never returns. Needs STRIPE_WEBHOOK_SECRET."""
    secret = config.STRIPE_WEBHOOK_SECRET
    if not secret:
        raise HTTPException(404, "Webhook not configured")
    payload = await request.body()
    if not _verify_webhook(payload, request.headers.get("stripe-signature", ""), secret):
        raise HTTPException(400, "Invalid signature")
    event = json.loads(payload)
    if event.get("type") in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        try:
            _credit_session(event["data"]["object"])
        except HTTPException:
            pass  # not one of our top-ups
    return {"received": True}


@router.post("/wallet/demo-credit")
def demo_credit(body: TopUpBody, user=Depends(require_user)):
    """Virtual funds for local development, only while Stripe isn't configured."""
    if _stripe_mode() != "off":
        raise HTTPException(400, "Use Stripe to add funds.")
    with _Tx() as conn:
        bal = _move(conn, user["id"], "demo_credit", body.amount * 100, "virtual funds")
    return {"ok": True, "balance_inr": bal / 100}
