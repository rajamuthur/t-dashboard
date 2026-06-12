from datetime import datetime, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends
from ..auth import get_current_user
from ..db import get_db
from ..sync_service import get_sync_status, run_sync
import aiosqlite

router = APIRouter(prefix="/sync", tags=["sync"])

@router.get("/ping")
async def sync_ping():
    return {"ok": True}

@router.post("/trigger")
async def trigger_sync(
    timeframe: str,
    background_tasks: BackgroundTasks,
    _: str = Depends(get_current_user),
):
    background_tasks.add_task(run_sync, timeframe)
    return {"status": "started", "timeframe": timeframe}


@router.get("/status")
async def sync_status(
    timeframe: str = None,
    _: str = Depends(get_current_user),
):
    return get_sync_status(timeframe)


@router.get("/logs")
async def sync_logs(
    timeframe: str = None,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    if timeframe:
        async with db.execute(
            "SELECT id, timeframe, started_at, finished_at, status, message, rows_saved, stocks_scanned, data_from, data_to"
            " FROM sync_log WHERE timeframe=? ORDER BY started_at DESC LIMIT 50",
            [timeframe],
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute(
            "SELECT id, timeframe, started_at, finished_at, status, message, rows_saved, stocks_scanned, data_from, data_to"
            " FROM sync_log ORDER BY started_at DESC LIMIT 50"
        ) as cur:
            rows = await cur.fetchall()
    cols = ["id", "timeframe", "started_at", "finished_at", "status", "message", "rows_saved", "stocks_scanned", "data_from", "data_to"]
    return [dict(zip(cols, r)) for r in rows]


@router.get("/coverage")
async def sync_coverage(
    timeframe: str,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Return per-period candle coverage from the candles table (one row per week/month close)."""
    async with db.execute(
        "SELECT date, COUNT(DISTINCT symbol) as stocks_count"
        " FROM candles WHERE timeframe=?"
        " GROUP BY date ORDER BY date DESC LIMIT 104",
        [timeframe],
    ) as cur:
        rows = await cur.fetchall()

    result = []
    for date_str, stocks_count in rows:
        entry: dict = {"period_date": date_str, "stocks_count": stocks_count}
        if timeframe == "week":
            # date is always a Friday (W-FRI resampling); compute Monday
            fri = datetime.strptime(date_str, "%Y-%m-%d")
            mon = fri - timedelta(days=4)
            entry["week_start"] = mon.strftime("%Y-%m-%d")
        result.append(entry)
    return result
