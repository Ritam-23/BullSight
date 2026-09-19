"""Company logos: resolved from free logo CDNs, validated, and cached on disk.

Indian listings are looked up by ISIN on Parqet's logo CDN first (best coverage for NSE/BSE), US listings by
ticker on Financial Modeling Prep. Tiny or broken images are rejected so the UI can show a letter badge.
"""
import io
import json
import re
import threading
import time

import requests
from PIL import Image

import config
import market
import symbols

LOGO_DIR = config.DATA_DIR / "logos"
LOGO_DIR.mkdir(exist_ok=True)
MISS_TTL = 7 * 24 * 3600
MIN_SIZE = 48  # px; smaller "logos" are favicons or placeholders
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _candidates(symbol: str) -> list[str]:
    meta = symbols.lookup(symbol) or {}
    urls = []
    isin = meta.get("isin")
    twin = market.nse_twin(symbol)
    if not isin and twin:
        isin = (symbols.lookup(twin) or {}).get("isin")
    parqet_isin = [f"https://assets.parqet.com/logos/isin/{isin}?format=png"] if isin else []
    fmp = [f"https://financialmodelingprep.com/image-stock/{s}.png" for s in dict.fromkeys([symbol, twin]) if s]
    parqet_sym = [f"https://assets.parqet.com/logos/symbol/{symbol}?format=png"]
    if meta.get("country") == "IN" or symbol.endswith((".NS", ".BO")):
        urls = parqet_isin + fmp
    else:
        urls = fmp + parqet_isin + parqet_sym
    return urls


def _fetch(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=config.HTTP_HEADERS, timeout=8)
    except requests.RequestException:
        return None
    if not r.ok or not r.headers.get("content-type", "").startswith("image/") or len(r.content) < 200:
        return None
    try:
        img = Image.open(io.BytesIO(r.content))
        img.load()
    except Exception:  # noqa: BLE001
        return None
    if min(img.size) < MIN_SIZE and max(img.size) < 64:
        return None
    # Normalize to a PNG no larger than 128px on the long edge.
    img = img.convert("RGBA")
    img.thumbnail((128, 128))
    img = _on_dark_if_white(img)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _on_dark_if_white(img: Image.Image) -> Image.Image:
    """White-on-transparent logos (made for dark backgrounds) vanish on the app's white badge:
    place those on a dark square tile instead."""
    alpha = img.getchannel("A")
    visible = [p for p, a in zip(img.convert("RGB").getdata(), alpha.getdata()) if a > 40]
    if not visible or len(visible) / (img.width * img.height) > 0.95:
        return img  # opaque logos carry their own background
    light = sum(1 for r, g, b in visible if min(r, g, b) > 225) / len(visible)
    if light < 0.85:
        return img
    side = max(img.size) + 24
    tile = Image.new("RGBA", (side, side), (26, 26, 25, 255))
    tile.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return tile


def _paths(symbol: str):
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", symbol)
    return LOGO_DIR / f"{safe}.png", LOGO_DIR / f"{safe}.miss"


def get(symbol: str) -> bytes | None:
    symbol = symbol.upper()
    if symbol.startswith("^") or "=" in symbol:
        return None  # indices and futures have no company logo
    png, miss = _paths(symbol)
    if png.exists():
        return png.read_bytes()
    if miss.exists() and time.time() - miss.stat().st_mtime < MISS_TTL:
        return None
    with _locks_guard:
        lock = _locks.setdefault(symbol, threading.Lock())
    with lock:  # one download per symbol even when a table requests it many times at once
        if png.exists():
            return png.read_bytes()
        for url in _candidates(symbol):
            data = _fetch(url)
            if data:
                png.write_bytes(data)
                miss.unlink(missing_ok=True)
                return data
        miss.write_text(json.dumps({"at": time.time()}))
        return None
