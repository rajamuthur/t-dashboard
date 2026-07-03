"""Futures basis scanner endpoints."""
from fastapi import APIRouter, BackgroundTasks, Depends, Query

from ..auth import get_current_user
from ..futures_scan import run_scan, get_status, get_result, history, chart_data

router = APIRouter(prefix="/futures", tags=["futures"])


@router.post("/scan")
async def scan(
    background_tasks: BackgroundTasks,
    threshold: float = Query(default=5.0, ge=0.1, le=50.0),
    curve_tol: float = Query(default=1.5, ge=0.1, le=50.0),
    months: int = Query(default=3, ge=2, le=6),
    alert: bool = Query(default=True),
    auto: bool = Query(default=False),
    _: str = Depends(get_current_user),
):
    background_tasks.add_task(run_scan, threshold, curve_tol, months, alert, auto)
    return {"status": "started", "threshold": threshold, "curve_tol": curve_tol}


@router.get("/status")
async def status(_: str = Depends(get_current_user)):
    return get_status()


@router.get("/result")
async def result(_: str = Depends(get_current_user)):
    return get_result()


@router.get("/history")
async def get_history(limit: int = Query(default=100, ge=1, le=500), _: str = Depends(get_current_user)):
    return await history(limit)


@router.get("/chart")
async def chart(symbol: str = Query(...), _: str = Depends(get_current_user)):
    return await chart_data(symbol.strip().upper())
