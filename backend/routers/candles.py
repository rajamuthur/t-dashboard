from typing import Optional
from fastapi import APIRouter, Depends, Query
from ..auth import get_current_user
from ..db import get_db
import aiosqlite

router = APIRouter(prefix="/candles", tags=["candles"])


@router.get("")
async def get_candles(
    symbol: str,
    timeframe: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = Query(default=500, le=2000),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    q = "SELECT symbol, timeframe, date, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=?"
    p: list = [symbol, timeframe]
    if from_date:
        q += " AND date >= ?"; p.append(from_date)
    if to_date:
        q += " AND date <= ?";   p.append(to_date)
    q += " ORDER BY date ASC LIMIT ?"
    p.append(limit)
    async with db.execute(q, p) as cur:
        rows = await cur.fetchall()
    cols = ["symbol", "timeframe", "date", "open", "high", "low", "close", "volume"]
    return [dict(zip(cols, r)) for r in rows]


@router.get("/symbols")
async def list_symbols(
    timeframe: str,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    async with db.execute(
        "SELECT DISTINCT symbol FROM candles WHERE timeframe=? ORDER BY symbol", [timeframe]
    ) as cur:
        return [r[0] for r in await cur.fetchall()]
