"""Gap-Reversal indicator — config, current-setup scan, backtest, chart."""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..gap_reversal_scan import (
    get_config, save_config, run_scan, get_status, get_result, chart_data,
)
from ..gap_reversal_backtest import run_backtest, get_bt_status, get_bt_result
from ..universe_service import list_universes

router = APIRouter(prefix="/gap-reversal", tags=["gap-reversal"])


class CfgIn(BaseModel):
    ema_length: Optional[int] = Field(None, ge=2, le=400)
    ema_source: Optional[str] = None
    rsi_length: Optional[int] = Field(None, ge=2, le=200)
    rsi_ma_length: Optional[int] = Field(None, ge=1, le=200)
    band_upper: Optional[float] = Field(None, ge=50, le=100)
    band_middle: Optional[float] = Field(None, ge=0, le=100)
    band_lower: Optional[float] = Field(None, ge=0, le=50)
    gap_pct: Optional[float] = Field(None, ge=0, le=50)
    rr_targets: Optional[List[float]] = None
    max_hold_bars: Optional[int] = Field(None, ge=1, le=250)
    universe: Optional[str] = None
    timeframe: Optional[str] = None
    direction: Optional[str] = Field(None, pattern="^(both|bull|bear)$")


@router.get("/config")
async def read_config(_: str = Depends(get_current_user)):
    return await get_config()


@router.patch("/config")
async def update_config(payload: CfgIn, _: str = Depends(get_current_user)):
    patch = payload.model_dump(exclude_none=True)
    if "rr_targets" in patch:
        # sanitise: positive, unique, sorted, ≤ 8 entries
        vals = sorted({round(float(x), 2) for x in patch["rr_targets"] if float(x) > 0})
        patch["rr_targets"] = vals[:8] or [3, 5, 7, 10]
    return await save_config(patch)


@router.get("/universes")
async def universes(_: str = Depends(get_current_user)):
    return await list_universes()


# --- scan (current setups) ---
@router.post("/scan")
async def scan(_: str = Depends(get_current_user)):
    await run_scan()
    return get_result()


@router.get("/scan")
async def scan_result(_: str = Depends(get_current_user)):
    return get_result()


@router.get("/scan/status")
async def scan_status(_: str = Depends(get_current_user)):
    return get_status()


# --- backtest ---
@router.post("/backtest")
async def backtest(_: str = Depends(get_current_user)):
    return await run_backtest()


@router.get("/backtest")
async def backtest_result(_: str = Depends(get_current_user)):
    return get_bt_result()


@router.get("/backtest/status")
async def backtest_status(_: str = Depends(get_current_user)):
    return get_bt_status()


@router.get("/chart")
async def chart(symbol: str = Query(...), _: str = Depends(get_current_user)):
    return await chart_data(symbol.strip().upper())
