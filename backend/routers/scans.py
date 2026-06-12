import json
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import JSONResponse
from ..auth import get_current_user
from ..db import _get_db_path, get_db
from ..scanners.registry import get_scanner, list_analysis_types
from ..outcome_service import evaluate_outcome
import aiosqlite
import asyncio
import pandas as pd
from datetime import date, datetime, timedelta, timezone

router = APIRouter(prefix="/scans", tags=["scans"])


@router.get("/types")
async def get_types(_: str = Depends(get_current_user)):
    return list_analysis_types()


@router.get("/week-calendar")
async def get_week_calendar(
    analysis_type: str = "3candle_reversal",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    weeks: int = Query(default=52, ge=1, le=260),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    Return a list of ISO week buckets (Mon–Fri) for the weekly timeframe.
    Each bucket includes the matched signal IDs for that week.
    Empty weeks are included so the UI can show "no match" rows.
    """
    today = date.today()

    # Determine date range
    if to_date:
        end = date.fromisoformat(to_date)
    else:
        end = today

    if from_date:
        start = date.fromisoformat(from_date)
    else:
        start = end - timedelta(weeks=weeks)

    # Align start to the Monday of its week
    start = start - timedelta(days=start.weekday())

    # Build week buckets
    buckets = []
    cur_mon = start
    while cur_mon <= end:
        cur_fri = cur_mon + timedelta(days=4)
        buckets.append({
            "week_start": cur_mon.isoformat(),
            "week_end":   cur_fri.isoformat(),
            "signals":    [],
        })
        cur_mon += timedelta(weeks=1)

    # Fetch all matched scan results in range
    async with db.execute(
        """SELECT id, symbol, timeframe, analysis_type, scanned_at, matched,
                  details, candle_date, outcome, outcome_price, outcome_date, is_eow_alert
           FROM scan_results
           WHERE timeframe='week' AND matched=1
             AND analysis_type=?
             AND candle_date >= ? AND candle_date <= ?
           ORDER BY candle_date ASC""",
        [analysis_type, start.isoformat(), end.isoformat()],
    ) as cur:
        rows = await cur.fetchall()

    cols = ["id","symbol","timeframe","analysis_type","scanned_at","matched","details",
            "candle_date","outcome","outcome_price","outcome_date","is_eow_alert"]
    signals_by_week: dict[str, list] = {}
    for row in rows:
        item = dict(zip(cols, row))
        if item["details"]:
            item["details"] = json.loads(item["details"])
        cd = item["candle_date"]
        if not cd:
            continue
        # Find the Monday of this candle's week
        try:
            cd_date = date.fromisoformat(cd[:10])
        except ValueError:
            continue
        mon = (cd_date - timedelta(days=cd_date.weekday())).isoformat()
        signals_by_week.setdefault(mon, []).append(item)

    for bucket in buckets:
        bucket["signals"] = signals_by_week.get(bucket["week_start"], [])

    return buckets


@router.get("/{scan_id}/detail")
async def get_scan_detail(
    scan_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Return the signal row + pattern candles (window_size) + up to 2 subsequent candles.

    Window size and marker metadata come from the scanner class so each pattern
    can declare its own shape (e.g. 4-candle `twin_doji_continuation`).
    """
    async with db.execute("SELECT * FROM scan_results WHERE id=?", [scan_id]) as cur:
        row = await cur.fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    cols_sr = ["id","symbol","timeframe","analysis_type","scanned_at","matched","details","candle_date","outcome","outcome_price","outcome_date"]
    signal = dict(zip(cols_sr, row))
    if signal["details"]:
        signal["details"] = json.loads(signal["details"])

    candle_date   = signal["candle_date"]
    symbol        = signal["symbol"]
    timeframe     = signal["timeframe"]
    analysis_type = signal["analysis_type"]

    # Look up scanner metadata. Fall back to legacy 3-candle defaults if the
    # scanner isn't registered (old rows from retired patterns).
    window_size   = 3
    marker_labels = None
    marker_colors = None
    marker_offset = 0
    legend        = None
    try:
        scanner = get_scanner(analysis_type)
        window_size   = getattr(scanner, "window_size", 3) or 3
        marker_labels = getattr(scanner, "marker_labels", None)
        marker_colors = getattr(scanner, "marker_colors", None)
        marker_offset = getattr(scanner, "marker_offset", 0) or 0
        legend        = getattr(scanner, "legend", None)
    except Exception:
        pass

    # Get pattern candles = window_size candles ending at candle_date
    async with db.execute(
        "SELECT date,open,high,low,close,volume FROM candles"
        " WHERE symbol=? AND timeframe=? AND date<=? ORDER BY date DESC LIMIT ?",
        [symbol, timeframe, candle_date, window_size],
    ) as cur:
        pattern_rows = list(reversed(await cur.fetchall()))

    # Get up to 2 subsequent candles
    async with db.execute(
        "SELECT date,open,high,low,close,volume FROM candles"
        " WHERE symbol=? AND timeframe=? AND date>? ORDER BY date ASC LIMIT 2",
        [symbol, timeframe, candle_date],
    ) as cur:
        next_rows = await cur.fetchall()

    cols_c = ["date","open","high","low","close","volume"]
    candles = [dict(zip(cols_c, r)) for r in pattern_rows + list(next_rows)]
    return {
        "signal":         signal,
        "candles":        candles,
        "pattern_length": len(pattern_rows),
        "window_size":    window_size,
        "marker_labels":  marker_labels,
        "marker_colors":  marker_colors,
        "marker_offset":  marker_offset,
        "legend":         legend,
    }


@router.post("/{scan_id}/fetch-outcome")
async def fetch_outcome(
    scan_id: int,
    _: str = Depends(get_current_user),
):
    """Fetch subsequent candles from DB (already synced) and evaluate outcome."""
    result = await evaluate_outcome(scan_id)
    return result


@router.get("")
async def get_scans(
    timeframe: Optional[str] = None,
    analysis_type: Optional[str] = None,
    matched_only: bool = True,
    outcome: Optional[str] = None,
    symbol_filter: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    sort_by: str = "candle_date",
    sort_dir: str = "desc",
    limit: int = Query(default=25, le=200),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    parts, params = ["1=1"], []
    if timeframe:
        parts.append("timeframe=?");     params.append(timeframe)
    if analysis_type:
        parts.append("analysis_type=?"); params.append(analysis_type)
    if matched_only:
        parts.append("matched=1")
    if outcome:
        parts.append("outcome=?");       params.append(outcome)
    if symbol_filter:
        parts.append("symbol LIKE ?");   params.append(f"%{symbol_filter}%")
    if from_date:
        parts.append("candle_date>=?");  params.append(from_date)
    if to_date:
        parts.append("candle_date<=?");  params.append(to_date)

    where = " AND ".join(parts)

    # Validate sort_by to prevent SQL injection
    allowed_sort = {"candle_date", "symbol", "outcome", "scanned_at"}
    if sort_by not in allowed_sort:
        sort_by = "candle_date"
    sort_dir = "ASC" if sort_dir.lower() == "asc" else "DESC"

    # Total count
    async with db.execute(f"SELECT COUNT(*) FROM scan_results WHERE {where}", params) as cur:
        total = (await cur.fetchone())[0]

    query = f"""
        SELECT id, symbol, timeframe, analysis_type, scanned_at, matched, details, candle_date,
               outcome, outcome_price, outcome_date
        FROM scan_results
        WHERE {where}
        ORDER BY {sort_by} {sort_dir}
        LIMIT ? OFFSET ?
    """
    async with db.execute(query, params + [limit, offset]) as cur:
        rows = await cur.fetchall()

    cols = ["id","symbol","timeframe","analysis_type","scanned_at","matched","details",
            "candle_date","outcome","outcome_price","outcome_date"]
    out = []
    for row in rows:
        item = dict(zip(cols, row))
        if item["details"]:
            item["details"] = json.loads(item["details"])
        out.append(item)

    # Return total in header
    headers = {"X-Total-Count": str(total), "Access-Control-Expose-Headers": "X-Total-Count"}
    return JSONResponse(content=out, headers=headers)


@router.post("/run")
async def run_scan(
    timeframe: str,
    analysis_type: str = "3candle_reversal",
    background_tasks: BackgroundTasks = None,
    _: str = Depends(get_current_user),
):
    async def _do_scan():
        db_path = _get_db_path()
        scanner = get_scanner(analysis_type)
        scanned_at = datetime.now(timezone.utc).isoformat()
        matched = []
        async with aiosqlite.connect(db_path) as db:
            async with db.execute(
                "SELECT DISTINCT symbol FROM candles WHERE timeframe=?", [timeframe]
            ) as cur:
                symbols = [r[0] for r in await cur.fetchall()]
            for symbol in symbols:
                async with db.execute(
                    "SELECT date, open, high, low, close, volume FROM candles"
                    " WHERE symbol=? AND timeframe=? ORDER BY date ASC",
                    [symbol, timeframe],
                ) as cur:
                    rows = await cur.fetchall()
                if not rows:
                    continue
                df = pd.DataFrame(
                    list(rows), columns=["date", "open", "high", "low", "close", "volume"]
                ).set_index("date")
                # Scan all historical windows
                history = await asyncio.to_thread(scanner.scan_history, symbol, timeframe, df)
                for result in history:
                    # Skip if this (symbol, timeframe, analysis_type, candle_date) already recorded
                    async with db.execute(
                        "SELECT 1 FROM scan_results WHERE symbol=? AND timeframe=? AND analysis_type=? AND candle_date=?",
                        [symbol, timeframe, analysis_type, result.candle_date],
                    ) as cur:
                        exists = await cur.fetchone()
                    if not exists:
                        await db.execute(
                            """INSERT INTO scan_results
                               (symbol, timeframe, analysis_type, scanned_at, matched, details, candle_date)
                               VALUES (?, ?, ?, ?, 1, ?, ?)""",
                            [symbol, timeframe, analysis_type, scanned_at,
                             json.dumps(result.details) if result.details else None,
                             result.candle_date],
                        )
                    if result.matched:
                        matched.append({"symbol": symbol, "candle_date": result.candle_date, **(result.details or {})})
            await db.commit()
        return matched

    if background_tasks:
        background_tasks.add_task(_do_scan)
        return {"status": "started", "timeframe": timeframe, "analysis_type": analysis_type}
    return {"results": await _do_scan()}
