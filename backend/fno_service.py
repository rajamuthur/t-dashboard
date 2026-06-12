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


async def get_fo_stocks() -> list[str]:
    """Return F&O stock list: NSE live → config table → FO_STOCKS env var."""
    # 1. Try NSE live
    try:
        stocks = await asyncio.to_thread(_fetch_from_nse)
        if stocks:
            return stocks
    except Exception:
        pass

    # 2. Try config table
    try:
        db_path = _get_db_path()
        async with aiosqlite.connect(db_path) as db:
            async with db.execute(
                "SELECT value FROM config WHERE key='weekly_stocks'"
            ) as cur:
                row = await cur.fetchone()
        if row:
            stocks = json.loads(row[0])
            if stocks:
                return stocks
    except Exception:
        pass

    # 3. Env var fallback
    raw = os.getenv("FO_STOCKS", "")
    return [s.strip() for s in raw.split(",") if s.strip()]
