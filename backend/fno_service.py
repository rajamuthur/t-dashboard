import asyncio
import json
import os

import aiosqlite
import requests

from .db import _get_db_path

_NSE_FO_URL = (
    "https://www.nseindia.com/api/equity-stockIndices"
    "?index=SECURITIES%20IN%20F%26O"
)
_NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
}


def _fetch_from_nse() -> list[str]:
    session = requests.Session()
    session.get("https://www.nseindia.com/", headers=_NSE_HEADERS, timeout=10)
    resp = session.get(_NSE_FO_URL, headers=_NSE_HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    stocks = []
    for item in data.get("data", []):
        sym = item.get("symbol", "").strip()
        if sym and "NIFTY" not in sym.upper():
            stocks.append(f"NSE:{sym}-EQ")
    return sorted(stocks)


async def _read_fo_cache(db_path: str) -> list[str]:
    try:
        async with aiosqlite.connect(db_path) as db:
            async with db.execute("SELECT value FROM config WHERE key='weekly_stocks'") as cur:
                row = await cur.fetchone()
        if row:
            return json.loads(row[0]) or []
    except Exception:
        pass
    return []


async def get_fo_stocks() -> list[str]:
    """Return the current F&O stock list.

    PRIMARY: the Fyers F&O master (public CSV, token-free, auto-refreshed daily)
    — the authoritative live list, so the count stays current (e.g. 208) instead
    of the old hand/NSE cache that drifts stale (was 213 with 7 delisted names).
    FALLBACK: the config cache → NSE live → env var, for when the master is
    briefly unavailable.
    """
    db_path = _get_db_path()
    try:
        from .fyers_fo_master import fo_stock_symbols
        stocks = await asyncio.to_thread(fo_stock_symbols)
        if len(stocks) >= 100:
            return stocks
    except Exception:
        pass

    cached = await _read_fo_cache(db_path)
    if len(cached) >= 100:
        return cached

    # No usable cache — fetch live, accept only a full response, and cache it.
    try:
        stocks = await asyncio.to_thread(_fetch_from_nse)
        if len(stocks) >= 100:
            try:
                async with aiosqlite.connect(db_path) as db:
                    await db.execute(
                        "INSERT INTO config (key, value) VALUES ('weekly_stocks', ?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        [json.dumps(stocks)],
                    )
                    await db.commit()
            except Exception:
                pass
            return stocks
    except Exception:
        pass

    if cached:                     # partial cache is still better than nothing
        return cached
    raw = os.getenv("FO_STOCKS", "")
    return [s.strip() for s in raw.split(",") if s.strip()]
