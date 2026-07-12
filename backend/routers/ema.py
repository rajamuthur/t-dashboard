"""EMA 50/200 cross scanner endpoints."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from ..auth import get_current_user
from ..ema_scan import run_scan, get_status, get_result, chart_data
from ..universe_service import list_universes

router = APIRouter(prefix="/ema", tags=["ema"])

_TF = {"day", "week"}


@router.post("/scan")
async def scan(
    background_tasks: BackgroundTasks,
    universe: str = Query(default="nifty50"),
    timeframe: str = Query(default="day"),
    cross_window: int = Query(default=10, ge=1, le=120),
    near_pct: float = Query(default=2.0, ge=0.1, le=25.0),
    near_bars: int = Query(default=10, ge=2, le=60),
    _: str = Depends(get_current_user),
):
    if timeframe not in _TF:
        raise HTTPException(400, f"Unsupported timeframe: {timeframe}")
    background_tasks.add_task(run_scan, universe, timeframe, cross_window, near_pct, near_bars)
    return {"status": "started", "universe": universe, "timeframe": timeframe}


@router.get("/status")
async def status(_: str = Depends(get_current_user)):
    return get_status()


@router.get("/result")
async def result(_: str = Depends(get_current_user)):
    return get_result()


@router.get("/universes")
async def universes(_: str = Depends(get_current_user)):
    return await list_universes()


@router.get("/chart")
async def chart(
    symbol: str = Query(...),
    timeframe: str = Query(default="day"),
    _: str = Depends(get_current_user),
):
    if timeframe not in _TF:
        raise HTTPException(400, f"Unsupported timeframe: {timeframe}")
    return await chart_data(symbol.strip().upper(), timeframe)
