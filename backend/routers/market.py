"""Market data — headline index snapshot for the header ticker."""
import asyncio

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..market_service import index_snapshot

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/indices")
async def indices(_: str = Depends(get_current_user)):
    """NIFTY 50 + NIFTY BANK value / points / % plus whether the market is open."""
    from ..futures_scan import market_open
    data = await asyncio.to_thread(index_snapshot)
    is_open, reason = await market_open()
    return {"indices": data, "market_open": is_open, "reason": reason}
