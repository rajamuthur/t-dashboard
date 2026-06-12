import json
import os
from typing import Optional

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..db import _get_db_path, get_db
from ..ai_service import get_or_create_ai_analysis
from ..daily_scan_service import get_scan_status, run_daily_pattern_scan

router = APIRouter(prefix="/daily-scans", tags=["daily-scans"])

ALLOWED_ANALYSIS_TYPES = {"tight_range"}


# ---------------------------------------------------------------------------
# Run scan
# ---------------------------------------------------------------------------

@router.post("/run")
async def run_scan(
    background_tasks: BackgroundTasks,
    analysis_type: str = Query(default="tight_range"),
    _: str = Depends(get_current_user),
):
    if analysis_type not in ALLOWED_ANALYSIS_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown analysis_type: {analysis_type}")
    background_tasks.add_task(run_daily_pattern_scan, analysis_type)
    return {"status": "started", "analysis_type": analysis_type}


@router.get("/status")
async def scan_status(_: str = Depends(get_current_user)):
    return get_scan_status()


# ---------------------------------------------------------------------------
# Sessions (history)
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(
    analysis_type: Optional[str] = None,
    limit: int = Query(default=30, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    q = "SELECT * FROM daily_scan_sessions"
    params: list = []
    if analysis_type:
        q += " WHERE analysis_type=?"
        params.append(analysis_type)
    q += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)

    db.row_factory = aiosqlite.Row
    async with db.execute(q, params) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    async with db.execute(
        "SELECT * FROM daily_scan_sessions WHERE id=?", [session_id]
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    async with db.execute(
        """SELECT sr.id, sr.symbol, sr.candle_date, sr.scanned_at, sr.details,
                  ai.id AS ai_id
           FROM scan_results sr
           LEFT JOIN ai_analysis ai
             ON ai.symbol=sr.symbol AND ai.analysis_type=sr.analysis_type
                AND ai.scan_date=sr.candle_date
           WHERE sr.session_id=? AND sr.timeframe='day' AND sr.matched=1
           ORDER BY sr.symbol ASC""",
        [session_id],
    ) as cur:
        results = await cur.fetchall()

    return {
        "session": dict(row),
        "results": [_format_result(r) for r in results],
    }


# ---------------------------------------------------------------------------
# Results list
# ---------------------------------------------------------------------------

@router.get("")
async def list_results(
    analysis_type: str = Query(default="tight_range"),
    session_id: Optional[int] = None,
    symbol_filter: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    sort_by: str = Query(default="candle_date", regex="^(candle_date|symbol|scanned_at)$"),
    sort_dir: str = Query(default="desc", regex="^(asc|desc)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    filters = ["sr.timeframe='day'", "sr.analysis_type=?", "sr.matched=1"]
    params: list = [analysis_type]

    if session_id is not None:
        filters.append("sr.session_id=?")
        params.append(session_id)
    if symbol_filter:
        filters.append("sr.symbol LIKE ?")
        params.append(f"%{symbol_filter.upper()}%")
    if from_date:
        filters.append("sr.candle_date >= ?")
        params.append(from_date)
    if to_date:
        filters.append("sr.candle_date <= ?")
        params.append(to_date)

    where = " AND ".join(filters)
    count_sql = f"SELECT COUNT(*) FROM scan_results sr WHERE {where}"
    db.row_factory = aiosqlite.Row

    async with db.execute(count_sql, params) as cur:
        total = (await cur.fetchone())[0]

    data_sql = f"""
        SELECT sr.id, sr.symbol, sr.candle_date, sr.scanned_at, sr.details, sr.session_id,
               ai.id AS ai_id
        FROM scan_results sr
        LEFT JOIN ai_analysis ai
          ON ai.symbol=sr.symbol AND ai.analysis_type=sr.analysis_type
             AND ai.scan_date=sr.candle_date
        WHERE {where}
        ORDER BY sr.{sort_by} {sort_dir.upper()}
        LIMIT ? OFFSET ?
    """
    async with db.execute(data_sql, params + [limit, offset]) as cur:
        rows = await cur.fetchall()

    return JSONResponse(
        content=[_format_result(r) for r in rows],
        headers={"X-Total-Count": str(total)},
    )


# ---------------------------------------------------------------------------
# Single result detail
# ---------------------------------------------------------------------------

@router.get("/{scan_id}/detail")
async def get_detail(
    scan_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    async with db.execute(
        "SELECT * FROM scan_results WHERE id=? AND timeframe='day'", [scan_id]
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Scan result not found")

    signal = dict(row)
    if signal.get("details"):
        signal["details"] = json.loads(signal["details"])

    # Return last 40 daily candles for the symbol (enough for 30-candle chart + context)
    async with db.execute(
        """SELECT date, open, high, low, close, volume FROM candles
           WHERE symbol=? AND timeframe='day'
           ORDER BY date DESC LIMIT 40""",
        [signal["symbol"]],
    ) as cur:
        candle_rows = await cur.fetchall()

    candles = [
        {"date": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
        for r in reversed(candle_rows)
    ]

    return {
        "signal": signal,
        "candles": candles,
        "entry_close": signal["details"].get("entry_close") if signal.get("details") else None,
        "stop_loss": signal["details"].get("stop_loss")   if signal.get("details") else None,
        "band_high": signal["details"].get("band_high")   if signal.get("details") else None,
    }


# ---------------------------------------------------------------------------
# AI analysis
# ---------------------------------------------------------------------------

@router.post("/{scan_id}/ai-analysis")
async def ai_analysis(
    scan_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    async with db.execute(
        "SELECT * FROM scan_results WHERE id=? AND timeframe='day'", [scan_id]
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Scan result not found")

    signal = dict(row)
    details = json.loads(signal["details"]) if signal.get("details") else {}

    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY not configured")

    result = await get_or_create_ai_analysis(
        scan_result_id=signal["id"],
        symbol=signal["symbol"],
        analysis_type=signal["analysis_type"],
        scan_date=signal["candle_date"],
        details=details,
    )
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_result(row) -> dict:
    d = dict(row)
    if d.get("details"):
        try:
            d["details"] = json.loads(d["details"])
        except Exception:
            pass
    d["has_ai_analysis"] = bool(d.pop("ai_id", None))
    return d
