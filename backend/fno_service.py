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
    """Return F&O stock list: cached config → NSE live (validated) → env var.

    Cache-FIRST: the F&O list changes rarely, and NSE's equity-stockIndices API
    is flaky/blocked from data-centre IPs (it intermittently returns a non-JSON
    error page or a partial list). Hitting it on every scan stalled the run
    ("Resolving universe…") and once yielded a truncated 50-symbol universe. So
    we trust the cache when present and only fall back to a *validated* live
    fetch, refreshing the cache when that succeeds.
    """
    db_path = _get_db_path()
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
