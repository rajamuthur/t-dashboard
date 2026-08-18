"""P&L notifications — config, notification log, and a manual EOD-summary trigger."""
from __future__ import annotations

from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..db import get_db
from ..pnl_watch import get_config, save_config, run_eod_summary

router = APIRouter(prefix="/pnl", tags=["pnl"])


class PnlConfigIn(BaseModel):
    enabled: Optional[bool] = None
    profit_threshold: Optional[float] = Field(None, ge=0)
    profit_interval_min: Optional[int] = Field(None, ge=1, le=240)
    loss_threshold: Optional[float] = Field(None, ge=0)
    loss_interval_min: Optional[int] = Field(None, ge=1, le=240)
    base_check_min: Optional[int] = Field(None, ge=1, le=60)
    eod_time: Optional[str] = Field(None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")
    expiry_trading_days: Optional[int] = Field(None, ge=0, le=60)
    spike_enabled: Optional[bool] = None
    spike_pct: Optional[float] = Field(None, ge=0.1, le=50)
    spike_window_min: Optional[int] = Field(None, ge=1, le=240)
    market_open_enabled: Optional[bool] = None
    market_open_time: Optional[str] = Field(None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")


@router.get("/config")
async def read_config(_: str = Depends(get_current_user)):
    return await get_config()


@router.patch("/config")
async def update_config(payload: PnlConfigIn, _: str = Depends(get_current_user)):
    cfg = await save_config(payload.model_dump(exclude_none=True))
    # Apply new cadence / times to the running scheduler immediately.
    try:
        from ..downloaders.scheduler import reschedule_pnl, reschedule_pnl_eod, reschedule_pnl_market_open
        reschedule_pnl(cfg["base_check_min"])
        reschedule_pnl_eod(cfg["eod_time"])
        reschedule_pnl_market_open(cfg["market_open_time"])
    except Exception:
        pass
    return cfg


@router.get("/notifications")
async def notifications(
    kind: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    q = "SELECT * FROM pnl_notifications WHERE 1=1"
    p: list = []
    if kind:
        q += " AND kind = ?"; p.append(kind)
    q += " ORDER BY id DESC LIMIT ?"; p.append(limit)
    async with db.execute(q, p) as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("/run-eod")
async def run_eod(_: str = Depends(get_current_user)):
    """Send the EOD P&L summary to Telegram right now (bypasses the trading-day gate)."""
    return await run_eod_summary(force=True)


@router.post("/run-open")
async def run_open(_: str = Depends(get_current_user)):
    """Send the market-open P&L + index brief to Telegram right now."""
    from ..pnl_watch import run_market_open_summary
    return await run_market_open_summary(force=True)
