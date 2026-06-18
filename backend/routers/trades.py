"""Trade journal + P&L analyzer endpoints."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..db import get_db
from ..trades_catalog import (
    INDEX_CATALOG, STOCK_LOT_SIZES, lookup_lot_size, underlying_yahoo_symbol,
    list_expiries, format_option_symbol, format_future_symbol,
)
from ..fyers_fo_master import future_symbol as fo_future_symbol, option_symbol as fo_option_symbol

router = APIRouter(prefix="/trades", tags=["trades"])

_TRADE_COLS = (
    "id", "instrument_type", "underlying", "symbol", "side", "option_type",
    "strike", "expiry_date", "lot_size", "num_lots", "entry_price", "entry_at",
    "exit_price", "exit_at", "current_price", "current_at", "status", "notes",
    "created_at",
)


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in _TRADE_COLS}


def _qty(t: dict) -> int:
    return int(t["lot_size"] or 1) * int(t["num_lots"] or 1)


def _pnl(t: dict) -> dict:
    """Compute realized OR unrealized P&L for a trade row dict.
    Returns { pnl, pnl_pct, ref_price, qty }."""
    qty = _qty(t)
    side = (t["side"] or "buy").lower()
    entry = float(t["entry_price"] or 0)
    if t["status"] == "closed":
        ref = float(t["exit_price"] or entry)
    else:
        ref = float(t["current_price"] or entry)
    if side == "sell":
        pnl = (entry - ref) * qty
    else:
        pnl = (ref - entry) * qty
    pnl_pct = ((ref - entry) / entry * 100) if entry else 0.0
    if side == "sell":
        pnl_pct = -pnl_pct
    return {"pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 4), "ref_price": ref, "qty": qty}


# --------------------------------------------------------------------------
# Pydantic schemas
# --------------------------------------------------------------------------
class TradeIn(BaseModel):
    instrument_type: str = Field(..., pattern="^(equity|future|option)$")
    underlying: str
    side: str = Field("buy", pattern="^(buy|sell)$")
    option_type: Optional[str] = Field(None, pattern="^(CE|PE)$")
    strike: Optional[float] = None
    expiry_date: Optional[str] = None     # YYYY-MM-DD
    lot_size: Optional[int] = None
    num_lots: int = 1
    entry_price: float
    entry_at: Optional[str] = None        # ISO date or datetime; defaults to now()
    notes: Optional[str] = None
    # For equity, the underlying may be a full Yahoo symbol like RELIANCE.NS.


class TradePatch(BaseModel):
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    exit_at: Optional[str] = None
    entry_at: Optional[str] = None        # let user fix backdated trades
    status: Optional[str] = Field(None, pattern="^(open|closed)$")
    current_price: Optional[float] = None
    notes: Optional[str] = None
    num_lots: Optional[int] = None
    lot_size: Optional[int] = None


def _normalize_iso(value: Optional[str]) -> Optional[str]:
    """Accept 'YYYY-MM-DD' or full ISO. Returns canonical ISO seconds string, or None."""
    if not value:
        return None
    v = value.strip()
    if not v:
        return None
    # Date-only → 09:30 IST so backdated trades land inside the trading session.
    if len(v) == 10 and v[4] == "-" and v[7] == "-":
        try:
            d = datetime.strptime(v, "%Y-%m-%d")
            # Treat as IST 09:30 then convert to UTC for storage consistency.
            ist = d.replace(hour=9, minute=30) - timedelta(hours=5, minutes=30)
            return ist.replace(tzinfo=timezone.utc).isoformat(timespec="seconds")
        except ValueError:
            return None
    # Otherwise let datetime parse it; fall back to raw on failure.
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat(timespec="seconds")
    except Exception:
        return v


# --------------------------------------------------------------------------
# Catalog endpoints (used by the form)
# --------------------------------------------------------------------------
@router.get("/catalog")
async def catalog(_: str = Depends(get_current_user)):
    return {
        "indices": [{"key": k, **v} for k, v in INDEX_CATALOG.items()],
        "stocks": sorted(STOCK_LOT_SIZES.keys()),
    }


@router.get("/fo-underlyings")
async def fo_underlyings(_: str = Depends(get_current_user)):
    """Clean F&O stock underlyings (no Yahoo .NS suffix / ^ indices) from the
    live Fyers master — for the trade form's Stock (F&O) picker."""
    try:
        from ..fyers_fo_master import get_lot_sizes
        idx = set(INDEX_CATALOG.keys())
        stocks = sorted(u for u in get_lot_sizes() if u not in idx)
        if stocks:
            return {"underlyings": stocks}
    except Exception:
        pass
    return {"underlyings": sorted(STOCK_LOT_SIZES.keys())}


@router.get("/lot-size")
async def lot_size(underlying: str, _: str = Depends(get_current_user)):
    n = lookup_lot_size(underlying)
    if n is None:
        return {"underlying": underlying, "lot_size": None}
    return {"underlying": underlying.upper(), "lot_size": n}


@router.get("/expiries")
async def expiries(underlying: str, _: str = Depends(get_current_user)):
    return {"underlying": underlying.upper(), **list_expiries(underlying)}


# --------------------------------------------------------------------------
# CRUD
# --------------------------------------------------------------------------
@router.get("")
async def list_trades(
    status: Optional[str] = Query(default=None, pattern="^(open|closed)$"),
    instrument_type: Optional[str] = Query(default=None, pattern="^(equity|future|option)$"),
    limit: int = Query(default=200, le=1000),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    cols = ", ".join(_TRADE_COLS)
    q = f"SELECT {cols} FROM trades WHERE 1=1"
    p: list = []
    if status:
        q += " AND status = ?"; p.append(status)
    if instrument_type:
        q += " AND instrument_type = ?"; p.append(instrument_type)
    q += " ORDER BY entry_at DESC LIMIT ?"; p.append(limit)
    async with db.execute(q, p) as cur:
        rows = await cur.fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        d.update(_pnl(d))
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_trade(
    payload: TradeIn,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    underlying = payload.underlying.strip().upper()

    # Lot size: explicit > catalog > 1 (equity sensible default)
    lot_size = payload.lot_size
    if lot_size is None or lot_size <= 0:
        looked = lookup_lot_size(underlying)
        lot_size = looked if looked else (1 if payload.instrument_type == "equity" else 1)

    if payload.instrument_type == "option":
        if not payload.option_type or payload.strike is None or not payload.expiry_date:
            raise HTTPException(400, "Options need option_type, strike, and expiry_date")
        symbol = format_option_symbol(underlying, payload.expiry_date, payload.option_type, payload.strike)
    elif payload.instrument_type == "future":
        if not payload.expiry_date:
            raise HTTPException(400, "Futures need expiry_date")
        symbol = format_future_symbol(underlying, payload.expiry_date)
    else:
        symbol = underlying

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    entry_at = _normalize_iso(payload.entry_at) or now
    cur = await db.execute(
        """INSERT INTO trades
           (instrument_type, underlying, symbol, side, option_type, strike, expiry_date,
            lot_size, num_lots, entry_price, entry_at, status, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)""",
        [
            payload.instrument_type, underlying, symbol, payload.side,
            payload.option_type, payload.strike, payload.expiry_date,
            lot_size, payload.num_lots, payload.entry_price, entry_at,
            payload.notes, now,
        ],
    )
    await db.commit()
    trade_id = cur.lastrowid
    async with db.execute(
        f"SELECT {', '.join(_TRADE_COLS)} FROM trades WHERE id = ?", [trade_id]
    ) as q:
        row = await q.fetchone()
    d = _row_to_dict(row)
    d.update(_pnl(d))
    return d


@router.patch("/{trade_id}")
async def patch_trade(
    trade_id: int,
    payload: TradePatch,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    fields = []
    params: list = []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    exit_at = _normalize_iso(payload.exit_at) or now

    if payload.exit_price is not None:
        fields += ["exit_price = ?", "exit_at = ?", "status = 'closed'"]
        params += [payload.exit_price, exit_at]
    elif payload.status == "closed":
        fields += ["status = 'closed'", "exit_at = COALESCE(exit_at, ?)"]
        params += [exit_at]
    elif payload.status == "open":
        fields += ["status = 'open'", "exit_price = NULL", "exit_at = NULL"]

    if payload.current_price is not None:
        fields += ["current_price = ?", "current_at = ?"]
        params += [payload.current_price, now]
    if payload.entry_at is not None:
        normalized = _normalize_iso(payload.entry_at)
        if normalized:
            fields += ["entry_at = ?"]; params.append(normalized)
    if payload.notes is not None:
        fields += ["notes = ?"]; params.append(payload.notes)
    if payload.num_lots is not None:
        fields += ["num_lots = ?"]; params.append(payload.num_lots)
    if payload.lot_size is not None:
        fields += ["lot_size = ?"]; params.append(payload.lot_size)
    if payload.entry_price is not None:
        fields += ["entry_price = ?"]; params.append(payload.entry_price)

    if not fields:
        raise HTTPException(400, "No fields to update")

    params.append(trade_id)
    await db.execute(f"UPDATE trades SET {', '.join(fields)} WHERE id = ?", params)
    await db.commit()

    async with db.execute(
        f"SELECT {', '.join(_TRADE_COLS)} FROM trades WHERE id = ?", [trade_id]
    ) as q:
        row = await q.fetchone()
    if not row:
        raise HTTPException(404, "Trade not found")
    d = _row_to_dict(row)
    d.update(_pnl(d))
    return d


@router.delete("/{trade_id}", status_code=204)
async def delete_trade(
    trade_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    await db.execute("DELETE FROM trades WHERE id = ?", [trade_id])
    await db.commit()
    return None


# --------------------------------------------------------------------------
# Live price refresh (yfinance proxy)
# --------------------------------------------------------------------------
async def _fetch_price(yahoo_symbol: str) -> Optional[float]:
    import yfinance as yf

    def _fetch():
        t = yf.Ticker(yahoo_symbol)
        try:
            info = t.fast_info
            for attr in ("last_price", "regular_market_price", "previous_close"):
                v = getattr(info, attr, None)
                if v:
                    return float(v)
        except Exception:
            pass
        for period, interval in (("1d", "1m"), ("5d", "5m"), ("1mo", "1d")):
            try:
                df = t.history(period=period, interval=interval)
                if df is not None and not df.empty:
                    return float(df["Close"].iloc[-1])
            except Exception:
                continue
        return None

    return await asyncio.to_thread(_fetch)


def _fyers_contract_quote(trade: dict) -> Optional[float]:
    """LTP of the trade's ACTUAL contract via Fyers (futures/options price the
    real contract, not the spot). Returns None if no token / quote unavailable."""
    it = trade["instrument_type"]
    und = (trade["underlying"] or "").strip().upper()
    exp = trade.get("expiry_date")
    if it == "equity":
        sym = f"NSE:{und}-EQ"
    elif it == "future" and exp:
        sym = fo_future_symbol(und, exp)
    elif it == "option" and exp and trade.get("strike") and trade.get("option_type"):
        sym = fo_option_symbol(und, exp, trade["option_type"], float(trade["strike"]))
    else:
        sym = None
    if not sym:
        return None
    try:
        from ..downloaders.fyers import FyersDownloader
        return FyersDownloader().quote(sym)
    except Exception:
        return None


async def _refresh_trade(db: aiosqlite.Connection, trade: dict) -> Optional[float]:
    """Update a trade's current price from its REAL contract (Fyers LTP). For
    equity we fall back to the yfinance spot. Futures/options are NOT proxied
    with spot any more — if the real contract price isn't available (e.g. Fyers
    token expired) we leave current_price untouched rather than show a wrong one."""
    price = await asyncio.to_thread(_fyers_contract_quote, trade)

    if price is None and trade["instrument_type"] == "equity":
        yh = trade["underlying"]
        if "." not in yh and not yh.startswith("^"):
            yh = f"{yh}.NS"
        price = await _fetch_price(yh)

    if price is None:
        return None  # don't overwrite with a wrong/stale proxy
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    await db.execute(
        "UPDATE trades SET current_price = ?, current_at = ? WHERE id = ?",
        [price, now, trade["id"]],
    )
    await db.commit()
    return price


@router.post("/{trade_id}/refresh-price")
async def refresh_one(
    trade_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    async with db.execute(
        f"SELECT {', '.join(_TRADE_COLS)} FROM trades WHERE id = ?", [trade_id]
    ) as q:
        row = await q.fetchone()
    if not row:
        raise HTTPException(404, "Trade not found")
    trade = _row_to_dict(row)
    price = await _refresh_trade(db, trade)
    if price is None:
        raise HTTPException(
            422,
            "Price unavailable — options need manual update via PATCH {current_price}",
        )
    trade["current_price"] = price
    trade.update(_pnl(trade))
    return trade


@router.post("/refresh-all")
async def refresh_all(
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    cols = ", ".join(_TRADE_COLS)
    async with db.execute(
        f"SELECT {cols} FROM trades WHERE status = 'open' AND instrument_type != 'option'"
    ) as q:
        rows = await q.fetchall()
    updated = 0
    for r in rows:
        if await _refresh_trade(db, _row_to_dict(r)) is not None:
            updated += 1
    return {"refreshed": updated, "skipped": len(rows) - updated}


# --------------------------------------------------------------------------
# Dashboard aggregates
# --------------------------------------------------------------------------
@router.get("/dashboard")
async def dashboard(
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    cols = ", ".join(_TRADE_COLS)
    async with db.execute(f"SELECT {cols} FROM trades") as q:
        rows = await q.fetchall()
    trades = [_row_to_dict(r) for r in rows]
    for t in trades: t.update(_pnl(t))

    open_trades = [t for t in trades if t["status"] == "open"]
    closed_trades = [t for t in trades if t["status"] == "closed"]
    wins = [t for t in closed_trades if t["pnl"] > 0]

    by_type: dict = {}
    for t in trades:
        k = t["instrument_type"]
        b = by_type.setdefault(k, {"open": 0, "closed": 0, "realized_pnl": 0.0, "unrealized_pnl": 0.0})
        if t["status"] == "closed":
            b["closed"] += 1
            b["realized_pnl"] += t["pnl"]
        else:
            b["open"] += 1
            b["unrealized_pnl"] += t["pnl"]

    realized = sum(t["pnl"] for t in closed_trades)
    unrealized = sum(t["pnl"] for t in open_trades)
    return {
        "open_count": len(open_trades),
        "closed_count": len(closed_trades),
        "total_count": len(trades),
        "realized_pnl": round(realized, 2),
        "unrealized_pnl": round(unrealized, 2),
        "total_pnl": round(realized + unrealized, 2),
        "win_rate": round(len(wins) / len(closed_trades) * 100, 2) if closed_trades else None,
        "wins": len(wins),
        "losses": len(closed_trades) - len(wins),
        "by_instrument_type": {k: {**v, "realized_pnl": round(v["realized_pnl"], 2), "unrealized_pnl": round(v["unrealized_pnl"], 2)} for k, v in by_type.items()},
    }
