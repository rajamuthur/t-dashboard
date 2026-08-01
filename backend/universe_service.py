"""
Stock-universe resolver.

Maps a universe key (fo / nifty50 / nifty100 / nifty500 / midcap) to its list of
NSE symbols. Constituents are fetched live from NSE's equity-stockIndices API
(same approach as fno_service), cached to the `config` table, and fall back to
the cache on failure. The F&O universe delegates to fno_service.

Cache key per universe: `universe_<key>` (JSON list). All symbols are normalised
to the `NSE:<SYMBOL>-EQ` form the rest of the app uses.
"""
import asyncio
import csv
import io
import json

import aiosqlite
import requests

from .db import _get_db_path

# NSE's anti-bot blocks the equity-stockIndices API from data-centre IPs, but the
# static index-constituent CSVs on archives.nseindia.com (a CDN) are reachable.
_NSE_CSV_URL = "https://archives.nseindia.com/content/indices/{file}"
_NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
}

# key -> (label, NSE constituent CSV file | None for F&O which uses fno_service)
UNIVERSES: dict[str, tuple[str, str | None]] = {
    "fo":       ("F&O", None),
    "nifty50":  ("NIFTY 50", "ind_nifty50list.csv"),
    "nifty100": ("Large Cap (NIFTY 100)", "ind_nifty100list.csv"),
    "nifty500": ("NIFTY 500", "ind_nifty500list.csv"),
    "midcap":   ("Midcap (NIFTY 150)", "ind_niftymidcap150list.csv"),
    "bank":     ("Bank (NIFTY Bank)", "ind_niftybanklist.csv"),
}
DEFAULT_UNIVERSE = "fo"


def _fetch_index_from_nse(csv_file: str) -> list[str]:
    """Fetch an index's constituents from the NSE archive CSV (synchronous)."""
    url = _NSE_CSV_URL.format(file=csv_file)
    resp = requests.get(url, headers=_NSE_HEADERS, timeout=20)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))
    stocks = []
    for row in reader:
        sym = (row.get("Symbol") or "").strip().upper()
        series = (row.get("Series") or "EQ").strip().upper()
        if sym and series in ("EQ", ""):
            stocks.append(f"NSE:{sym}-EQ")
    return sorted(set(stocks))


async def _read_cache(db_path: str, key: str) -> list[str]:
    try:
        async with aiosqlite.connect(db_path) as db:
            async with db.execute("SELECT value FROM config WHERE key=?", [f"universe_{key}"]) as cur:
                row = await cur.fetchone()
        if row:
            return json.loads(row[0]) or []
    except Exception:
        pass
    return []


async def _write_cache(db_path: str, key: str, stocks: list[str]) -> None:
    try:
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "INSERT INTO config (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [f"universe_{key}", json.dumps(stocks)],
            )
            await db.commit()
    except Exception:
        pass


async def get_universe_stocks(universe: str | None) -> list[str]:
    """Resolve a universe key to its symbol list (live NSE → cache → F&O fallback)."""
    key = (universe or DEFAULT_UNIVERSE).lower()
    if key == "all":
        return await get_all_universe_symbols()
    if key not in UNIVERSES:
        key = DEFAULT_UNIVERSE
    if key == "fo":
        from .fno_service import get_fo_stocks
        return await get_fo_stocks()

    _label, index_name = UNIVERSES[key]
    db_path = _get_db_path()
    try:
        stocks = await asyncio.to_thread(_fetch_index_from_nse, index_name)
        if stocks:
            await _write_cache(db_path, key, stocks)
            return stocks
    except Exception:
        pass
    # Live fetch failed — use cache.
    cached = await _read_cache(db_path, key)
    if cached:
        return cached
    # Last resort: F&O (always available) so a scan still has something to run on.
    from .fno_service import get_fo_stocks
    return await get_fo_stocks()


async def list_universes() -> list[dict]:
    """Return [{key, label, count}] for the UI dropdown (counts from cache)."""
    db_path = _get_db_path()
    out = []
    for key, (label, index_name) in UNIVERSES.items():
        if key == "fo":
            try:
                from .fno_service import get_fo_stocks
                count = len(await get_fo_stocks())
            except Exception:
                count = 0
        else:
            count = len(await _read_cache(db_path, key))
        out.append({"key": key, "label": label, "count": count})
    return out


async def get_all_universe_symbols() -> list[str]:
    """Union of every configured universe — used for one-time candle backfill."""
    seen: set[str] = set()
    for key in UNIVERSES:
        try:
            for s in await get_universe_stocks(key):
                seen.add(s)
        except Exception:
            pass
    return sorted(seen)
