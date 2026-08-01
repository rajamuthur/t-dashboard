"""Charts terminal — universe lists + real-time batch quotes for the stock list.
Candles are served by the shared /live-charts/candles?source=fyers endpoint."""
import asyncio

from fastapi import APIRouter, Depends, Query

from ..auth import get_current_user
from ..universe_service import list_universes, get_universe_stocks

router = APIRouter(prefix="/charts", tags=["charts"])


@router.get("/universes")
async def universes(_: str = Depends(get_current_user)):
    out = await list_universes()
    out.append({"key": "all", "label": "All stocks", "count": 0})
    return out


@router.get("/universe/{key}")
async def universe(key: str, _: str = Depends(get_current_user)):
    return {"key": key, "symbols": await get_universe_stocks(key)}


@router.get("/quotes")
async def quotes(symbols: str = Query(...), _: str = Depends(get_current_user)):
    """Real-time {symbol: {lp, chp, ch, name}} for a comma-separated symbol list."""
    syms = [s.strip() for s in symbols.split(",") if s.strip()]
    if not syms:
        return {}

    def _fetch():
        from ..downloaders.fyers import FyersDownloader
        return FyersDownloader().quotes_full(syms)

    return await asyncio.to_thread(_fetch)
