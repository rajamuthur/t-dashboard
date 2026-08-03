"""Chart alerts — CRUD, per-timeframe chart candles, notification log, config."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiosqlite
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..db import get_db, _get_db_path
from ..alert_watch import line_value

router = APIRouter(prefix="/alerts", tags=["alerts"])

_COLS = ("id", "symbol", "name", "timeframe", "kind", "condition", "repeat_mode",
         "price", "t1", "p1", "t2", "p2", "note", "status", "last_diff",
         "created_at", "triggered_at")

# timeframe -> (Fyers resolution, calendar days). 1wk/1mo fetch daily then resample.
# Keys match the fyers chart source so the Alerts chart and alerts agree.
_RES = {"5m": "5", "15m": "15", "30m": "30", "1h": "60", "1d": "D", "1wk": "D", "1mo": "D"}
_RANGE_DAYS = {"5m": 25, "15m": 50, "30m": 80, "1h": 100, "1d": 360, "1wk": 360, "1mo": 360}
_TF = set(_RES.keys())


def _now_unix() -> float:
    return datetime.now(timezone.utc).timestamp()


def _row(r) -> dict:
    d = {k: r[k] for k in _COLS}
    try:
        d["line_now"] = round(line_value(d, _now_unix()), 2) if line_value(d, _now_unix()) is not None else None
    except Exception:
        d["line_now"] = None
    return d


class AlertIn(BaseModel):
    symbol: str
    name: Optional[str] = None
    timeframe: str = "day"
    kind: str = Field(..., pattern="^(horizontal|trend)$")
    condition: str = Field(..., pattern="^(cross_up|cross_down)$")
    repeat_mode: str = Field("once", pattern="^(once|recurring)$")
    price: Optional[float] = None
    t1: Optional[int] = None
    p1: Optional[float] = None
    t2: Optional[int] = None
    p2: Optional[float] = None
    note: Optional[str] = None


class AlertPatch(BaseModel):
    name: Optional[str] = None
    condition: Optional[str] = Field(None, pattern="^(cross_up|cross_down)$")
    repeat_mode: Optional[str] = Field(None, pattern="^(once|recurring)$")
    price: Optional[float] = None
    t1: Optional[int] = None
    p1: Optional[float] = None
    t2: Optional[int] = None
    p2: Optional[float] = None
    note: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(active|triggered|disabled)$")


# --------------------------------------------------------------------------
# CRUD
# --------------------------------------------------------------------------
@router.get("")
async def list_alerts(
    symbol: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    q = f"SELECT {', '.join(_COLS)} FROM alerts WHERE 1=1"
    p: list = []
    if symbol:
        q += " AND symbol = ?"; p.append(symbol.strip().upper())
    if status:
        q += " AND status = ?"; p.append(status)
    q += " ORDER BY id DESC"
    async with db.execute(q, p) as cur:
        rows = await cur.fetchall()
    return [_row(r) for r in rows]


@router.get("/symbols")
async def symbols_with_alerts(db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    async with db.execute(
        """SELECT symbol, COUNT(*) AS total,
                  SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active
           FROM alerts GROUP BY symbol ORDER BY symbol"""
    ) as cur:
        rows = await cur.fetchall()
    return [{"symbol": r[0], "total": r[1], "active": r[2]} for r in rows]


@router.post("", status_code=201)
async def create_alert(payload: AlertIn, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    if payload.timeframe not in _TF:
        raise HTTPException(400, f"Unsupported timeframe: {payload.timeframe}")
    if payload.kind == "horizontal" and payload.price is None:
        raise HTTPException(400, "Horizontal alert needs a price")
    if payload.kind == "trend" and None in (payload.t1, payload.p1, payload.t2, payload.p2):
        raise HTTPException(400, "Trend alert needs t1, p1, t2, p2")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cur = await db.execute(
        """INSERT INTO alerts (symbol, name, timeframe, kind, condition, repeat_mode,
                               price, t1, p1, t2, p2, note, status, last_diff, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?)""",
        [payload.symbol.strip().upper(), payload.name, payload.timeframe, payload.kind,
         payload.condition, payload.repeat_mode, payload.price, payload.t1, payload.p1,
         payload.t2, payload.p2, payload.note, now],
    )
    await db.commit()
    async with db.execute(f"SELECT {', '.join(_COLS)} FROM alerts WHERE id=?", [cur.lastrowid]) as q:
        row = await q.fetchone()
    return _row(row)


@router.patch("/{alert_id}")
async def update_alert(alert_id: int, payload: AlertPatch, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    fields, params = [], []
    # Changing the level/condition (or re-arming) re-baselines cross detection.
    rebaseline = False
    for col in ("name", "condition", "repeat_mode", "price", "t1", "p1", "t2", "p2", "note"):
        val = getattr(payload, col)
        if val is not None:
            fields.append(f"{col} = ?"); params.append(val)
            if col in ("condition", "price", "t1", "p1", "t2", "p2"):
                rebaseline = True
    if payload.status is not None:
        fields.append("status = ?"); params.append(payload.status)
        if payload.status == "active":
            rebaseline = True
    if rebaseline:
        fields.append("last_diff = NULL")
    if not fields:
        raise HTTPException(400, "No fields to update")
    params.append(alert_id)
    await db.execute(f"UPDATE alerts SET {', '.join(fields)} WHERE id = ?", params)
    await db.commit()
    async with db.execute(f"SELECT {', '.join(_COLS)} FROM alerts WHERE id=?", [alert_id]) as q:
        row = await q.fetchone()
    if not row:
        raise HTTPException(404, "Alert not found")
    return _row(row)


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(alert_id: int, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    await db.execute("DELETE FROM alert_notifications WHERE alert_id = ?", [alert_id])
    await db.execute("DELETE FROM alerts WHERE id = ?", [alert_id])
    await db.commit()
    return None


# --------------------------------------------------------------------------
# Notifications log
# --------------------------------------------------------------------------
@router.get("/notifications")
async def notifications(
    alert_id: Optional[int] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    q = "SELECT * FROM alert_notifications WHERE 1=1"
    p: list = []
    if alert_id is not None:
        q += " AND alert_id = ?"; p.append(alert_id)
    q += " ORDER BY id DESC LIMIT ?"; p.append(limit)
    async with db.execute(q, p) as cur:
        return [dict(r) for r in await cur.fetchall()]


# --------------------------------------------------------------------------
# Config (check interval)
# --------------------------------------------------------------------------
class ConfigIn(BaseModel):
    minutes: int = Field(..., ge=1, le=240)


@router.get("/config")
async def get_config(db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    async with db.execute("SELECT value FROM config WHERE key='alert_check_minutes'") as cur:
        row = await cur.fetchone()
    return {"check_minutes": int(json.loads(row[0])) if row else 5}


@router.patch("/config")
async def set_config(payload: ConfigIn, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    await db.execute(
        "INSERT INTO config (key, value) VALUES ('alert_check_minutes', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [json.dumps(payload.minutes)],
    )
    await db.commit()
    try:
        from ..downloaders.scheduler import reschedule_alerts
        reschedule_alerts(payload.minutes)
    except Exception:
        pass
    return {"check_minutes": payload.minutes}


# --------------------------------------------------------------------------
# Chart candles (per timeframe)
# --------------------------------------------------------------------------
def _chart_candles(symbol: str, timeframe: str) -> list[dict]:
    from ..downloaders.fyers import FyersDownloader
    res = _RES.get(timeframe, "D")
    days = _RANGE_DAYS.get(timeframe, 360)
    d = FyersDownloader()
    end = datetime.now()
    start = end - timedelta(days=days)
    df = d.fetch_daily(symbol, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"), resolution=res)
    if df is None or df.empty:
        return []
    if timeframe == "1wk":
        df = d.resample_weekly(df)
    elif timeframe == "1mo":
        df = d.resample_monthly(df)
    intraday = timeframe in ("5m", "15m", "30m", "1h")
    fmt = "%Y-%m-%d %H:%M:%S" if intraday else "%Y-%m-%d"
    out = []
    for ts, r in df.iterrows():
        out.append({"date": pd.Timestamp(ts).strftime(fmt), "open": float(r["open"]), "high": float(r["high"]),
                    "low": float(r["low"]), "close": float(r["close"]), "volume": float(r.get("volume", 0) or 0)})
    return out[-1500:]


@router.get("/chart")
async def chart(
    symbol: str = Query(...),
    timeframe: str = Query(default="day"),
    _: str = Depends(get_current_user),
):
    if timeframe not in _TF:
        raise HTTPException(400, f"Unsupported timeframe: {timeframe}")
    candles = await asyncio.to_thread(_chart_candles, symbol.strip().upper(), timeframe)
    return {"candles": candles}
