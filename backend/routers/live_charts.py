from dataclasses import asdict
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import get_current_user
from ..data_source import get_source, list_sources

router = APIRouter(prefix="/live-charts", tags=["live-charts"])


@router.get("/sources")
async def get_sources(_: str = Depends(get_current_user)):
    return list_sources()


@router.get("/candles")
async def candles(
    source: str,
    symbol: str,
    timeframe: str,
    limit: int = Query(default=300, le=2000),
    _: str = Depends(get_current_user),
):
    try:
        src = get_source(source)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        rows = await src.fetch_candles(symbol, timeframe, limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{source} fetch failed: {e}")
    return [asdict(c) for c in rows]


@router.get("/quote")
async def quote(
    source: str,
    symbol: str,
    _: str = Depends(get_current_user),
):
    try:
        src = get_source(source)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        q = await src.fetch_quote(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{source} quote failed: {e}")
    if q is None:
        raise HTTPException(status_code=404, detail="quote unavailable")
    return asdict(q)


@router.get("/search")
async def search(
    source: str,
    q: str = "",
    limit: int = Query(default=20, le=250),
    _: str = Depends(get_current_user),
):
    try:
        src = get_source(source)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        matches = await src.search(q, limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{source} search failed: {e}")
    return [asdict(m) for m in matches]
