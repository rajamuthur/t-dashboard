"""Multi-timeframe pattern scanner endpoints (Phase 1)."""
import json
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..db import get_db
from ..pattern_scan_service import run_pattern_scan, get_pattern_scan_status
from ..scanners.registry import PATTERN_ANALYSIS_TYPES, get_scanner
from ..universe_service import get_universe_stocks, list_universes, UNIVERSES

router = APIRouter(prefix="/patterns", tags=["patterns"])

TIMEFRAMES = {"day", "week", "month", "5m", "15m", "30m", "1h", "4h"}
INTRADAY_TIMEFRAMES = {"5m", "15m", "30m", "1h", "4h"}

PATTERN_LABELS = {
    "morning_star": "Morning Star",
    "evening_star": "Evening Star",
    "flag_pennant": "Flag / Pennant",
    "cup_handle": "Cup & Handle",
    "ascending_triangle": "Ascending Triangle",
    "descending_triangle": "Descending Triangle",
    "symmetrical_triangle": "Symmetrical Triangle",
    "vcp": "VCP (Minervini)",
}

# Candles shown AFTER the pattern in the detail view.
_DETAIL_CONTEXT = 15
# Minimum candles shown in the detail chart, per timeframe (>= ~3 months for daily).
_DETAIL_MIN_CANDLES = {"day": 90, "week": 90, "month": 48,
                       "5m": 150, "15m": 150, "30m": 150, "1h": 150, "4h": 130}
_DETAIL_MIN_DEFAULT = 80
_DETAIL_MAX_CANDLES = 320
# Max charts pushed in a single "send to Telegram" action (rendering is CPU-bound).
_CHART_SEND_CAP = 10


@router.get("/types")
async def types(_: str = Depends(get_current_user)):
    return [
        {"key": k, "label": PATTERN_LABELS.get(k, k), "window": get_scanner(k).window_size}
        for k in sorted(PATTERN_ANALYSIS_TYPES)
    ]


@router.get("/universes")
async def universes(_: str = Depends(get_current_user)):
    return await list_universes()


@router.post("/run")
async def run(
    background_tasks: BackgroundTasks,
    analysis_type: str = Query(...),
    timeframe: str = Query(default="day"),
    universe: str = Query(default="fo"),
    _: str = Depends(get_current_user),
):
    if analysis_type not in PATTERN_ANALYSIS_TYPES:
        raise HTTPException(400, f"Unknown pattern: {analysis_type}")
    if timeframe not in TIMEFRAMES:
        raise HTTPException(400, f"Unsupported timeframe: {timeframe}")
    if universe not in UNIVERSES:
        raise HTTPException(400, f"Unknown universe: {universe}")
    background_tasks.add_task(run_pattern_scan, analysis_type, timeframe, universe)
    return {"status": "started", "analysis_type": analysis_type, "timeframe": timeframe, "universe": universe}


@router.get("/status")
async def status(_: str = Depends(get_current_user)):
    return get_pattern_scan_status()


@router.post("/backfill-daily")
async def backfill_daily_endpoint(
    background_tasks: BackgroundTasks,
    period: str = Query(default="5y"),
    _: str = Depends(get_current_user),
):
    """Bulk-load ~`period` of daily candles for all F&O stocks via yfinance."""
    from ..daily_backfill import run_backfill
    from ..fno_service import get_fo_stocks
    stocks = await get_fo_stocks()
    background_tasks.add_task(run_backfill, stocks, period)
    return {"status": "started", "period": period, "stocks": len(stocks)}


@router.get("/backfill-status")
async def backfill_status(_: str = Depends(get_current_user)):
    from ..daily_backfill import get_backfill_status
    return get_backfill_status()


@router.get("/sessions")
async def sessions(
    analysis_type: Optional[str] = None,
    timeframe: Optional[str] = None,
    limit: int = Query(default=30, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    q = "SELECT * FROM daily_scan_sessions WHERE 1=1"
    p: list = []
    if analysis_type:
        q += " AND analysis_type=?"; p.append(analysis_type)
    if timeframe:
        q += " AND timeframe=?"; p.append(timeframe)
    q += " ORDER BY started_at DESC LIMIT ?"; p.append(limit)
    db.row_factory = aiosqlite.Row
    async with db.execute(q, p) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def _universe_filter(universe: Optional[str]) -> Optional[list[str]]:
    """Resolve a universe key to its symbol list, or None for no filter.

    'fo' is treated as no-filter (it's the full default set the scans already
    cover), so the list isn't needlessly constrained when no narrower universe
    is chosen.
    """
    if not universe or universe == "fo" or universe not in UNIVERSES:
        return None
    syms = await get_universe_stocks(universe)
    return syms or None


@router.get("")
async def list_results(
    analysis_type: Optional[str] = None,
    timeframe: str = Query(default="day"),
    session_id: Optional[int] = None,
    symbol_filter: Optional[str] = None,
    outcome: Optional[str] = None,
    universe: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    sort_by: str = Query(default="candle_date", regex="^(candle_date|symbol|outcome|analysis_type)$"),
    sort_dir: str = Query(default="desc", regex="^(asc|desc)$"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    filters = ["matched=1", "timeframe=?"]
    p: list = [timeframe]
    if analysis_type:
        filters.append("analysis_type=?"); p.append(analysis_type)
    else:
        # restrict to pattern scanners only
        qmarks = ",".join("?" * len(PATTERN_ANALYSIS_TYPES))
        filters.append(f"analysis_type IN ({qmarks})"); p.extend(sorted(PATTERN_ANALYSIS_TYPES))
    uni_syms = await _universe_filter(universe)
    if uni_syms is not None:
        filters.append(f"symbol IN ({','.join('?' * len(uni_syms))})"); p.extend(uni_syms)
    if session_id is not None:
        filters.append("session_id=?"); p.append(session_id)
    if symbol_filter:
        filters.append("symbol LIKE ?"); p.append(f"%{symbol_filter.upper()}%")
    if outcome:
        filters.append("outcome=?"); p.append(outcome)
    if from_date:
        filters.append("candle_date >= ?"); p.append(from_date)
    if to_date:
        filters.append("candle_date <= ?"); p.append(to_date)
    where = " AND ".join(filters)

    db.row_factory = aiosqlite.Row
    async with db.execute(f"SELECT COUNT(*) AS n FROM scan_results WHERE {where}", p) as cur:
        total = (await cur.fetchone())["n"]
    async with db.execute(
        f"SELECT id, symbol, analysis_type, timeframe, candle_date, details, outcome, "
        f"outcome_price, outcome_date FROM scan_results WHERE {where} "
        f"ORDER BY {sort_by} {sort_dir.upper()} LIMIT ? OFFSET ?",
        p + [limit, offset],
    ) as cur:
        rows = await cur.fetchall()
    return JSONResponse(content=[_fmt(r) for r in rows], headers={"X-Total-Count": str(total)})


@router.get("/stats")
async def stats(
    analysis_type: Optional[str] = None,
    timeframe: str = Query(default="day"),
    symbol_filter: Optional[str] = None,
    universe: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    filters = ["matched=1", "timeframe=?"]
    p: list = [timeframe]
    if analysis_type:
        filters.append("analysis_type=?"); p.append(analysis_type)
    else:
        qmarks = ",".join("?" * len(PATTERN_ANALYSIS_TYPES))
        filters.append(f"analysis_type IN ({qmarks})"); p.extend(sorted(PATTERN_ANALYSIS_TYPES))
    uni_syms = await _universe_filter(universe)
    if uni_syms is not None:
        filters.append(f"symbol IN ({','.join('?' * len(uni_syms))})"); p.extend(uni_syms)
    if symbol_filter:
        filters.append("symbol LIKE ?"); p.append(f"%{symbol_filter.upper()}%")
    where = " AND ".join(filters)

    db.row_factory = aiosqlite.Row
    async with db.execute(
        f"SELECT COALESCE(outcome,'open') AS oc, COUNT(*) AS n FROM scan_results WHERE {where} GROUP BY oc", p
    ) as cur:
        rows = await cur.fetchall()
    counts = {r["oc"]: r["n"] for r in rows}
    success = counts.get("success", 0)
    failure = counts.get("failure", 0)
    open_ = counts.get("open", 0)
    no_trade = counts.get("no_trade", 0)
    total = success + failure + open_ + no_trade
    resolved = success + failure
    win_rate = round(success / resolved * 100, 1) if resolved else None
    return {
        "success": success, "failure": failure, "open": open_, "no_trade": no_trade,
        "total": total, "win_rate": win_rate,
    }


async def _detail_payload(db: aiosqlite.Connection, scan_id: int, full: bool = False) -> dict:
    db.row_factory = aiosqlite.Row
    async with db.execute("SELECT * FROM scan_results WHERE id=?", [scan_id]) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Scan result not found")
    signal = _fmt(row)
    det = signal.get("details") or {}
    tf = signal["timeframe"]
    scanner = get_scanner(signal["analysis_type"])
    window = scanner.window_size

    async with db.execute(
        "SELECT date, open, high, low, close, volume FROM candles "
        "WHERE symbol=? AND timeframe=? ORDER BY date ASC",
        [signal["symbol"], tf],
    ) as cur:
        rows = await cur.fetchall()
    all_candles = [{"date": str(r["date"]), "open": r["open"], "high": r["high"],
                    "low": r["low"], "close": r["close"], "volume": r["volume"]} for r in rows]

    if full:
        # Web detail: show ALL available history (the chart auto-fits; the user
        # zooms to the pattern). Telegram PNGs use the focused window below.
        candles = all_candles
    else:
        end_idx = next((i for i, c in enumerate(all_candles) if c["date"] == signal["candle_date"]), len(all_candles) - 1)
        # Focused window (PNG): pattern + leading history + trailing context.
        min_total = max(window + _DETAIL_CONTEXT, _DETAIL_MIN_CANDLES.get(tf, _DETAIL_MIN_DEFAULT))
        min_total = min(min_total, _DETAIL_MAX_CANDLES)
        lead = min_total - _DETAIL_CONTEXT
        lo = max(0, end_idx - lead + 1)
        hi = min(len(all_candles), end_idx + _DETAIL_CONTEXT + 1)
        candles = all_candles[lo:hi]

    return {
        "signal": signal,
        "candles": candles,
        "shapes": det.get("shapes", []),
        "entry_close": det.get("entry_close"),
        "stop_loss": det.get("stop_loss"),
        "target": det.get("target"),
        "direction": det.get("direction"),
    }


@router.get("/{scan_id}/detail")
async def detail(
    scan_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    return await _detail_payload(db, scan_id, full=True)


class SendChartsRequest(BaseModel):
    ids: List[int]
    title: Optional[str] = None


@router.post("/send-charts")
async def send_charts(
    body: SendChartsRequest,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    from ..telegram_service import get_telegram_config, send_photo
    from ..chart_render import render_pattern_png

    cfg = await get_telegram_config()
    if not cfg.get("bot_token") or not cfg.get("chat_id"):
        raise HTTPException(400, "Telegram not configured — set bot token + chat id in Settings")
    if not body.ids:
        raise HTTPException(400, "No patterns selected")

    import asyncio
    sent, failed = 0, 0
    errors: list = []
    for sid in body.ids[:_CHART_SEND_CAP]:
        try:
            payload = await _detail_payload(db, sid)
            sig = payload["signal"]
            sym = (sig["symbol"] or "").replace("NSE:", "").replace("-EQ", "")
            caption = _chart_caption(sig)
            title = f"{sym}  {sig.get('pattern_label', '')} ({sig['timeframe']})"
            # Render matplotlib OFF the event loop (CPU-bound, not async-safe inline).
            png = await asyncio.to_thread(render_pattern_png, sym, payload["candles"], payload["shapes"], title)
            if not png:
                failed += 1; errors.append(f"{sid}: render returned no image")
                continue
            res = await send_photo(png, caption)
            if res.get("ok"):
                sent += 1
            else:
                failed += 1; errors.append(f"{sid}: {res.get('error')}")
        except Exception as exc:
            import traceback, logging
            logging.getLogger("patterns").error("send-charts %s failed:\n%s", sid, traceback.format_exc())
            failed += 1; errors.append(f"{sid}: {type(exc).__name__}: {exc!r}")
    return {"ok": sent > 0, "sent": sent, "failed": failed, "errors": errors[:3]}


def _chart_caption(sig: dict) -> str:
    import html
    sym = html.escape((sig["symbol"] or "").replace("NSE:", "").replace("-EQ", ""))
    d = sig.get("direction") or ""
    emoji = "\U0001F7E2" if d == "bullish" else "\U0001F534"
    oc = sig.get("outcome") or "—"
    pnl = sig.get("pnl_pct")
    pnl_str = f" · P&amp;L <b>{'+' if (pnl or 0) >= 0 else ''}{pnl}%</b>" if pnl is not None else ""
    return (
        f"{emoji} <b>{sym}</b> · {html.escape(sig.get('pattern_label',''))} ({sig['timeframe']})\n"
        f"Entry <code>{sig.get('entry')}</code> · "
        f"Stop <code>{(sig.get('details') or {}).get('stop_loss')}</code> · "
        f"Target <code>{(sig.get('details') or {}).get('target')}</code>\n"
        f"{html.escape(sig.get('candle_date',''))} · {html.escape(oc)}{pnl_str}"
    )


def _fmt(row) -> dict:
    d = dict(row)
    if d.get("details"):
        try:
            d["details"] = json.loads(d["details"])
        except Exception:
            d["details"] = None
    det = d.get("details") or {}
    # Convenience top-level fields for the list table.
    d["entry"] = det.get("entry_close")
    d["exit"] = d.get("outcome_price")
    d["pnl_pct"] = det.get("pnl_pct")
    d["direction"] = det.get("direction")
    d["pattern_label"] = PATTERN_LABELS.get(d.get("analysis_type"), d.get("analysis_type"))
    return d
