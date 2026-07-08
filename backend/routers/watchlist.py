"""Named watchlists + their symbols, with live Fyers quotes.

Multiple lists, each holding Fyers-format symbols (NSE:RELIANCE-EQ,
NSE:NIFTY50-INDEX, NSE:SRF26AUGFUT). Prices come from Fyers `quotes_full`.
The chart is served by the `fyers` data source via the shared /live-charts APIs.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import get_current_user
from ..db import get_db
from ..fyers_fo_master import future_symbol as fo_future_symbol

router = APIRouter(prefix="/watchlists", tags=["watchlists"])

_INDEX_ALIAS = {
    "NIFTY": "NSE:NIFTY50-INDEX", "NIFTY50": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX", "NIFTYBANK": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX", "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
    "SENSEX": "BSE:SENSEX-INDEX",
}


def _normalize_symbol(s: str) -> str:
    """Turn user input into a Fyers symbol: 'RELIANCE' -> 'NSE:RELIANCE-EQ',
    index aliases -> '…-INDEX', anything already qualified ('NSE:…') as-is."""
    s = s.strip().upper()
    if ":" in s:
        return s
    if s in _INDEX_ALIAS:
        return _INDEX_ALIAS[s]
    return f"NSE:{s}-EQ"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _quotes_full(symbols: list[str]) -> dict:
    from ..downloaders.fyers import FyersDownloader
    if not symbols:
        return {}
    return FyersDownloader().quotes_full(symbols)


class WatchlistIn(BaseModel):
    name: str


class ItemIn(BaseModel):
    symbol: Optional[str] = None          # e.g. 'RELIANCE', 'NIFTY', 'NSE:SRF26AUGFUT'
    underlying: Optional[str] = None      # future helper: underlying + expiry -> contract
    expiry: Optional[str] = None          # YYYY-MM-DD


# --------------------------------------------------------------------------
# Watchlists (the named lists)
# --------------------------------------------------------------------------
@router.get("")
async def list_watchlists(db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    async with db.execute(
        """SELECT w.id, w.name, w.sort_order,
                  (SELECT COUNT(*) FROM watchlist_items i WHERE i.watchlist_id = w.id) AS item_count
           FROM watchlists w ORDER BY w.sort_order, w.id"""
    ) as cur:
        rows = await cur.fetchall()
    return [{"id": r[0], "name": r[1], "sort_order": r[2], "item_count": r[3]} for r in rows]


@router.post("", status_code=201)
async def create_watchlist(payload: WatchlistIn, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    async with db.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM watchlists") as cur:
        (order,) = await cur.fetchone()
    c = await db.execute(
        "INSERT INTO watchlists (name, sort_order, created_at) VALUES (?, ?, ?)",
        [name, order, _now()],
    )
    await db.commit()
    return {"id": c.lastrowid, "name": name, "sort_order": order, "item_count": 0}


@router.patch("/{wl_id}")
async def rename_watchlist(wl_id: int, payload: WatchlistIn, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    await db.execute("UPDATE watchlists SET name = ? WHERE id = ?", [name, wl_id])
    await db.commit()
    return {"id": wl_id, "name": name}


@router.delete("/{wl_id}", status_code=204)
async def delete_watchlist(wl_id: int, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    await db.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", [wl_id])
    await db.execute("DELETE FROM watchlists WHERE id = ?", [wl_id])
    await db.commit()
    return None


# --------------------------------------------------------------------------
# Items (symbols inside a list) + live quotes
# --------------------------------------------------------------------------
@router.get("/{wl_id}/items")
async def list_items(wl_id: int, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    async with db.execute(
        "SELECT id, symbol, label, sort_order FROM watchlist_items WHERE watchlist_id = ? ORDER BY sort_order, id",
        [wl_id],
    ) as cur:
        rows = await cur.fetchall()
    items = [{"id": r[0], "symbol": r[1], "label": r[2], "sort_order": r[3]} for r in rows]
    quotes = await asyncio.to_thread(_quotes_full, [it["symbol"] for it in items])
    for it in items:
        q = quotes.get(it["symbol"]) or {}
        it["lp"] = q.get("lp")
        it["chp"] = q.get("chp")
        it["ch"] = q.get("ch")
        if q.get("name"):
            it["label"] = it["label"] or q["name"]
    return items


@router.post("/{wl_id}/items", status_code=201)
async def add_item(wl_id: int, payload: ItemIn, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    async with db.execute("SELECT 1 FROM watchlists WHERE id = ?", [wl_id]) as cur:
        if not await cur.fetchone():
            raise HTTPException(404, "Watchlist not found")

    if payload.underlying and payload.expiry:
        symbol = fo_future_symbol(payload.underlying.strip().upper(), payload.expiry.strip())
    elif payload.symbol:
        symbol = _normalize_symbol(payload.symbol)
    else:
        raise HTTPException(400, "Provide a symbol, or an underlying + expiry")

    # Validate against a live quote (also gives us a display name).
    quotes = await asyncio.to_thread(_quotes_full, [symbol])
    info = quotes.get(symbol)
    if not info:
        raise HTTPException(422, f"Couldn't fetch a price for '{symbol}' — check the symbol (or Fyers token).")
    label = info.get("name") or symbol

    async with db.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM watchlist_items WHERE watchlist_id = ?", [wl_id]) as cur:
        (order,) = await cur.fetchone()
    await db.execute(
        "INSERT OR IGNORE INTO watchlist_items (watchlist_id, symbol, label, sort_order, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        [wl_id, symbol, label, order, _now()],
    )
    await db.commit()
    async with db.execute(
        "SELECT id, symbol, label, sort_order FROM watchlist_items WHERE watchlist_id = ? AND symbol = ?",
        [wl_id, symbol],
    ) as cur:
        r = await cur.fetchone()
    return {"id": r[0], "symbol": r[1], "label": r[2], "sort_order": r[3],
            "lp": info.get("lp"), "chp": info.get("chp"), "ch": info.get("ch")}


@router.delete("/{wl_id}/items/{item_id}", status_code=204)
async def delete_item(wl_id: int, item_id: int, db: aiosqlite.Connection = Depends(get_db), _: str = Depends(get_current_user)):
    await db.execute("DELETE FROM watchlist_items WHERE id = ? AND watchlist_id = ?", [item_id, wl_id])
    await db.commit()
    return None
