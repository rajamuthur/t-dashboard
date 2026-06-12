"""
NSE holiday management.

GET  /holidays          — return stored trading holiday list
POST /holidays/refresh  — fetch from NSE API, persist in config table
"""
import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import aiosqlite
import requests
from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import _get_db_path, get_db

router = APIRouter(prefix="/holidays", tags=["holidays"])

NSE_HOLIDAY_URL = "https://www.nseindia.com/api/holiday-master?type=trading"
NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
}


def _fetch_nse_holidays() -> list[str]:
    """
    Fetch NSE trading holidays from the NSE API.
    Returns a sorted list of ISO date strings (YYYY-MM-DD).
    Falls back to an empty list on failure.
    """
    try:
        session = requests.Session()
        # Warm up the session (NSE requires a cookie from the homepage)
        session.get("https://www.nseindia.com/", headers=NSE_HEADERS, timeout=10)
        resp = session.get(NSE_HOLIDAY_URL, headers=NSE_HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        dates: list[str] = []
        # The API returns {"CM": [...], "FO": [...], ...}  each entry has "tradingDate"
        for segment, entries in data.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                raw = entry.get("tradingDate", "")
                if not raw:
                    continue
                try:
                    # Format can be "16-Jan-2025" or "2025-01-16"
                    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
                        try:
                            d = datetime.strptime(raw.strip(), fmt).date()
                            dates.append(d.isoformat())
                            break
                        except ValueError:
                            continue
                except Exception:
                    continue
        # Deduplicate and sort
        return sorted(set(dates))
    except Exception:
        return []


# ---------------------------------------------------------------------------
# In-process helpers (no auth) used by eow_service / scheduler
# ---------------------------------------------------------------------------

async def get_holiday_set() -> set[str]:
    """Return the stored NSE holiday dates as a set of YYYY-MM-DD strings."""
    async with aiosqlite.connect(_get_db_path()) as db:
        async with db.execute("SELECT value FROM config WHERE key='nse_holidays'") as cur:
            row = await cur.fetchone()
    return set(json.loads(row[0]) if row else [])


def is_trading_day(d: date, holidays: set[str]) -> bool:
    """True if `d` is a weekday (Mon–Fri) and not in the NSE holiday set."""
    return d.weekday() < 5 and d.isoformat() not in holidays


def get_last_trading_day_of_week(ref: Optional[date] = None,
                                  holidays: Optional[set[str]] = None) -> date:
    """
    Return the last trading day of the ISO week that contains `ref`.
    Starts from Friday and walks backwards until a trading day is found.
    """
    if ref is None:
        ref = date.today()
    if holidays is None:
        holidays = set()
    # Go to Friday of that week
    friday = ref + timedelta(days=(4 - ref.weekday()))
    candidate = friday
    while candidate >= ref - timedelta(days=4):
        if is_trading_day(candidate, holidays):
            return candidate
        candidate -= timedelta(days=1)
    return friday  # fallback


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
async def get_holidays(
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    async with db.execute("SELECT value FROM config WHERE key='nse_holidays'") as cur:
        row = await cur.fetchone()
    async with db.execute("SELECT value FROM config WHERE key='nse_holidays_updated'") as cur:
        upd = await cur.fetchone()
    holidays = json.loads(row[0]) if row else []
    updated  = json.loads(upd[0]) if upd else ""
    return {"holidays": holidays, "count": len(holidays), "last_updated": updated}


@router.post("/refresh")
async def refresh_holidays(
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Fetch fresh holiday list from NSE and persist."""
    from ..db import _get_db_path as dbp
    import asyncio
    holidays = await asyncio.to_thread(_fetch_nse_holidays)
    now_str  = datetime.now(timezone.utc).isoformat()

    upsert = (
        "INSERT INTO config (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    )
    await db.execute(upsert, ["nse_holidays",         json.dumps(holidays)])
    await db.execute(upsert, ["nse_holidays_updated", json.dumps(now_str)])
    await db.commit()

    return {"holidays": holidays, "count": len(holidays), "last_updated": now_str}
