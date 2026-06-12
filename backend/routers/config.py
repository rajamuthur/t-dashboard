import asyncio
import json
from datetime import datetime, timezone

import aiosqlite
import requests
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..db import get_db

router = APIRouter(prefix="/config", tags=["config"])

NSE_FO_URL = (
    "https://www.nseindia.com/api/equity-stockIndices"
    "?index=SECURITIES%20IN%20F%26O"
)
NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
}


@router.get("/{key}")
async def get_config(
    key: str,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    async with db.execute("SELECT value FROM config WHERE key=?", [key]) as cur:
        row = await cur.fetchone()
    return {"key": key, "value": json.loads(row[0]) if row else None}


@router.put("/{key}")
async def set_config(
    key: str,
    body: dict,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    value = json.dumps(body.get("value"))
    await db.execute(
        "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [key, value],
    )
    await db.commit()
    return {"key": key, "value": json.loads(value)}


def _scrape_fo_stocks() -> list[str]:
    """Fetch current F&O stock list from NSE API. Returns NSE:SYMBOL-EQ list."""
    try:
        session = requests.Session()
        session.get("https://www.nseindia.com/", headers=NSE_HEADERS, timeout=10)
        resp = session.get(NSE_FO_URL, headers=NSE_HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        stocks = []
        for item in data.get("data", []):
            sym = item.get("symbol", "").strip()
            if sym and sym not in ("NIFTY 50", "Nifty 50"):
                stocks.append(f"NSE:{sym}-EQ")
        return sorted(stocks)
    except Exception as exc:
        raise RuntimeError(f"NSE fetch failed: {exc}") from exc


@router.post("/refresh-fo-stocks")
async def refresh_fo_stocks(
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Fetch latest F&O eligible stocks from NSE and update weekly/monthly stock lists."""
    try:
        stocks = await asyncio.to_thread(_scrape_fo_stocks)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    now_str = datetime.now(timezone.utc).isoformat()
    upsert  = (
        "INSERT INTO config (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    )
    stocks_json = json.dumps(stocks)
    await db.execute(upsert, ["weekly_stocks",       stocks_json])
    await db.execute(upsert, ["monthly_stocks",      stocks_json])
    await db.execute(upsert, ["fo_stocks_updated",   json.dumps(now_str)])
    await db.commit()

    return {"count": len(stocks), "stocks": stocks, "updated": now_str}
