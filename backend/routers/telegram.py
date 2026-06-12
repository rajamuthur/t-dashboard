"""Telegram integration — config + manual select-and-send of analysis/trades."""
import html
import json
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..db import get_db
from ..telegram_service import send_message, get_telegram_config
from .trades import _TRADE_COLS, _row_to_dict, _pnl

router = APIRouter(prefix="/telegram", tags=["telegram"])


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
class TelegramConfig(BaseModel):
    enabled: bool = False
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None


@router.get("/config")
async def get_config(
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    cfg = await get_telegram_config()
    token = cfg.get("bot_token") or ""
    # Never return the raw token — just whether it's set + a masked hint.
    masked = (token[:6] + "…" + token[-4:]) if len(token) > 12 else ("set" if token else "")
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "chat_id": cfg.get("chat_id", ""),
        "bot_token_set": bool(token),
        "bot_token_hint": masked,
    }


@router.put("/config")
async def set_config(
    body: TelegramConfig,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    current = await get_telegram_config()
    # Only overwrite the token if a non-empty one is supplied (lets the UI save
    # enabled/chat_id without re-sending the secret every time).
    new_token = body.bot_token if (body.bot_token and body.bot_token.strip()) else current.get("bot_token", "")
    merged = {
        "enabled": body.enabled,
        "bot_token": new_token,
        "chat_id": (body.chat_id if body.chat_id is not None else current.get("chat_id", "")),
    }
    await db.execute(
        "INSERT INTO config (key, value) VALUES ('telegram_config', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [json.dumps(merged)],
    )
    await db.commit()
    return {"ok": True, "enabled": merged["enabled"], "chat_id": merged["chat_id"], "bot_token_set": bool(new_token)}


@router.post("/test")
async def test(_: str = Depends(get_current_user)):
    res = await send_message(
        "✅ <b>Test message</b>\nYour Fyers Dashboard is connected to Telegram."
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Send failed"))
    return res


# ---------------------------------------------------------------------------
# Send selected records
# ---------------------------------------------------------------------------
class SendRequest(BaseModel):
    kind: str = Field(..., pattern="^(scans|trades)$")
    ids: List[int]
    title: Optional[str] = None


def _esc(v) -> str:
    return html.escape(str(v if v is not None else ""))


def _clean_symbol(sym: str) -> str:
    return (sym or "").replace("NSE:", "").replace("-EQ", "")


async def _format_scans(db: aiosqlite.Connection, ids: List[int], title: Optional[str]) -> str:
    qmarks = ",".join("?" * len(ids))
    async with db.execute(
        f"SELECT id, symbol, timeframe, analysis_type, candle_date, details, outcome "
        f"FROM scan_results WHERE id IN ({qmarks}) ORDER BY candle_date DESC",
        ids,
    ) as cur:
        rows = await cur.fetchall()
    if not rows:
        raise HTTPException(404, "No matching signals")

    header = _esc(title) if title else "📊 <b>Signal Analysis</b>"
    lines = [header, ""]
    for r in rows:
        details = {}
        try:
            details = json.loads(r[5]) if r[5] else {}
        except Exception:
            details = {}
        entry = details.get("entry_close")
        sl = details.get("stop_loss")
        risk = abs((entry or 0) - (sl or 0)) if (entry is not None and sl is not None) else None
        outcome = r[6] or "—"
        oc_emoji = {"success": "🟢", "failure": "🔴", "pending": "🟡", "open": "⚪"}.get(outcome, "")
        lines.append(f"<b>{_esc(_clean_symbol(r[1]))}</b>  <i>{_esc(r[4] or '')}</i>")
        bits = []
        if entry is not None: bits.append(f"Entry <code>{entry:.2f}</code>")
        if sl is not None: bits.append(f"SL <code>{sl:.2f}</code>")
        if risk is not None: bits.append(f"Risk <code>{risk:.2f}</code>")
        if bits:
            lines.append("  " + " · ".join(bits))
        lines.append(f"  {oc_emoji} {_esc(outcome)}")
        lines.append("")
    lines.append(f"<i>{len(rows)} signal(s)</i>")
    return "\n".join(lines)


async def _format_trades(db: aiosqlite.Connection, ids: List[int], title: Optional[str]) -> str:
    qmarks = ",".join("?" * len(ids))
    cols = ", ".join(_TRADE_COLS)
    async with db.execute(
        f"SELECT {cols} FROM trades WHERE id IN ({qmarks}) ORDER BY entry_at DESC",
        ids,
    ) as cur:
        rows = await cur.fetchall()
    if not rows:
        raise HTTPException(404, "No matching trades")

    header = _esc(title) if title else "💼 <b>Trades &amp; P&amp;L</b>"
    lines = [header, ""]
    total = 0.0
    for raw in rows:
        t = _row_to_dict(raw)
        t.update(_pnl(t))
        total += t["pnl"]
        side = (t["side"] or "").upper()
        side_emoji = "🟢" if side == "BUY" else "🔴"
        pnl = t["pnl"]
        pnl_emoji = "📈" if pnl >= 0 else "📉"
        ref = t["exit_price"] if t["status"] == "closed" else t["current_price"]
        lines.append(f"<b>{_esc(t['symbol'])}</b>  {side_emoji} {_esc(side)}")
        lines.append(
            f"  Qty <code>{t['qty']}</code> · Entry <code>{t['entry_price']:.2f}</code>"
            + (f" · {'Exit' if t['status']=='closed' else 'Now'} <code>{ref:.2f}</code>" if ref is not None else "")
        )
        sign = "+" if pnl >= 0 else ""
        lines.append(f"  {pnl_emoji} P&amp;L <code>{sign}{pnl:,.2f}</code> ({sign}{t['pnl_pct']:.2f}%) · {_esc(t['status'])}")
        lines.append("")
    sign = "+" if total >= 0 else ""
    lines.append(f"<b>Total P&amp;L: {sign}{total:,.2f}</b>  <i>({len(rows)} trade(s))</i>")
    return "\n".join(lines)


@router.post("/send")
async def send(
    body: SendRequest,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    if not body.ids:
        raise HTTPException(400, "No records selected")

    cfg = await get_telegram_config()
    if not cfg.get("bot_token") or not cfg.get("chat_id"):
        raise HTTPException(400, "Telegram not configured — set bot token + chat id in Settings")

    if body.kind == "scans":
        text = await _format_scans(db, body.ids, body.title)
    else:
        text = await _format_trades(db, body.ids, body.title)

    res = await send_message(text)
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=res.get("error", "Telegram send failed"))
    return {"ok": True, "sent": len(body.ids)}
