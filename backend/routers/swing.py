"""Swing-trading (Donchian breakout) endpoints — backtest + current signals."""
import json

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from ..auth import get_current_user
from ..db import get_db
from ..swing_backtest import run_swing_backtest, get_swing_status, current_signals, chart_data

router = APIRouter(prefix="/swing", tags=["swing"])

_TF = {"day", "week", "month"}


@router.post("/backtest")
async def backtest(
    background_tasks: BackgroundTasks,
    timeframe: str = Query(default="day"),
    lookback: int = Query(default=22, ge=2, le=200),
    universe: str = Query(default="nifty500"),
    _: str = Depends(get_current_user),
):
    if timeframe not in _TF:
        raise HTTPException(400, f"Unsupported timeframe: {timeframe}")
    background_tasks.add_task(run_swing_backtest, timeframe, lookback, universe)
    return {"status": "started", "timeframe": timeframe, "lookback": lookback, "universe": universe}


@router.get("/status")
async def status(_: str = Depends(get_current_user)):
    return get_swing_status()


@router.get("/current")
async def current(
    timeframe: str = Query(default="day"),
    lookback: int = Query(default=22, ge=2, le=200),
    universe: str = Query(default="nifty500"),
    _: str = Depends(get_current_user),
):
    if timeframe not in _TF:
        raise HTTPException(400, f"Unsupported timeframe: {timeframe}")
    return await current_signals(timeframe, lookback, universe)


@router.get("/chart")
async def chart(
    symbol: str = Query(...),
    timeframe: str = Query(default="day"),
    lookback: int = Query(default=22, ge=2, le=200),
    _: str = Depends(get_current_user),
):
    if timeframe not in _TF:
        raise HTTPException(400, f"Unsupported timeframe: {timeframe}")
    return await chart_data(symbol, timeframe, lookback)


@router.get("/runs/{run_id}")
async def get_run(run_id: int, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    db.row_factory = aiosqlite.Row
    async with db.execute("SELECT * FROM swing_runs WHERE id=?", [run_id]) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Run not found")
    d = dict(row)
    d["result"] = json.loads(d["result"]) if d.get("result") else None
    return d


@router.get("/runs")
async def list_runs(
    limit: int = Query(default=20, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    try:
        async with db.execute(
            "SELECT id, timeframe, lookback, universe, created_at FROM swing_runs ORDER BY id DESC LIMIT ?", [limit]
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []   # table not created until first run
