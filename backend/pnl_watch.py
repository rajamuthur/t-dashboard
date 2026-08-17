"""
P&L notifications: per-position profit/loss threshold alerts, an end-of-day P&L
summary, and an expiry "close soon" warning — all delivered to Telegram with a
chart, and logged to `pnl_notifications`.

- Threshold alerts are market-gated and re-fire on a per-position interval
  (profit default every 15m past +20k, loss every 10m past -15k). The interval
  is honoured by looking at the last `pnl_notifications` row for (trade, kind).
- The EOD summary is trading-day-gated (runs after close) and covers BOTH books
  (actual + paper), each line labelled, with a chart per open position.
- Expiry warning flags open F&O positions with <= N trading days to expiry.

P&L, price refresh and Fyers-symbol resolution are reused from routers.trades so
there is one source of truth for how a trade is priced.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
from datetime import date, datetime, timedelta, timezone

import aiosqlite

from .db import _get_db_path

logger = logging.getLogger(__name__)

DEFAULT_CFG = {
    "enabled": True,
    "profit_threshold": 20000,      # ₹; profit alert fires at/above this
    "profit_interval_min": 15,      # re-fire cadence while above
    "loss_threshold": 15000,        # ₹ (magnitude); loss alert fires at/below -this
    "loss_interval_min": 10,
    "base_check_min": 5,            # how often the watcher ticks (<= min interval)
    "eod_time": "16:00",            # HH:MM IST for the daily summary
    "expiry_trading_days": 10,      # warn when an F&O position has <= this many trading days left
}

_CFG_KEY = "pnl_alert_config"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
async def get_config() -> dict:
    async with aiosqlite.connect(_get_db_path()) as db:
        async with db.execute("SELECT value FROM config WHERE key=?", [_CFG_KEY]) as cur:
            row = await cur.fetchone()
    cfg = dict(DEFAULT_CFG)
    if row and row[0]:
        try:
            cfg.update({k: v for k, v in json.loads(row[0]).items() if k in DEFAULT_CFG})
        except Exception:
            pass
    return cfg


async def save_config(patch: dict) -> dict:
    cfg = await get_config()
    cfg.update({k: v for k, v in patch.items() if k in DEFAULT_CFG and v is not None})
    async with aiosqlite.connect(_get_db_path()) as db:
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [_CFG_KEY, json.dumps(cfg)],
        )
        await db.commit()
    return cfg


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _label(t: dict) -> str:
    """Human label for a trade — its stored symbol (equity: the underlying)."""
    return (t.get("symbol") or t.get("underlying") or "?").strip()


def trading_days_until(expiry: str | None, holidays: set[str]) -> int | None:
    """Trading days from tomorrow through the expiry date (inclusive). None if no
    expiry / unparseable; 0 if expiry is today or past."""
    if not expiry:
        return None
    from .routers.holidays import is_trading_day
    try:
        exp = datetime.strptime(expiry[:10], "%Y-%m-%d").date()
    except Exception:
        return None
    today = date.today()
    if exp <= today:
        return 0
    n, d = 0, today + timedelta(days=1)
    while d <= exp:
        if is_trading_day(d, holidays):
            n += 1
        d += timedelta(days=1)
    return n


def _hold_duration(entry_at: str | None) -> str:
    """'6d 3h' style holding duration from entry to now."""
    if not entry_at:
        return "—"
    try:
        dt = datetime.fromisoformat(entry_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return "—"
    secs = max(0, (datetime.now(timezone.utc) - dt).total_seconds())
    days = int(secs // 86400)
    hours = int((secs % 86400) // 3600)
    if days >= 1:
        return f"{days}d {hours}h" if hours else f"{days}d"
    mins = int((secs % 3600) // 60)
    return f"{hours}h {mins}m" if hours else f"{mins}m"


def _entry_date_ist(entry_at: str | None) -> str:
    if not entry_at:
        return "—"
    try:
        dt = datetime.fromisoformat(entry_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (dt + timedelta(hours=5, minutes=30)).strftime("%d %b %Y")
    except Exception:
        return "—"


def _inr(n: float) -> str:
    return f"{round(n):,}"


# ---------------------------------------------------------------------------
# Chart image for a position
# ---------------------------------------------------------------------------
def render_trade_png(trade: dict, info: dict) -> bytes | None:
    """Daily chart of the traded instrument (the real F&O contract, or the equity)
    with the entry-price line and a marker at the current price. None on failure."""
    from .chart_render import render_pattern_png
    from .alerts_image import fetch_alert_candles
    from .routers.trades import _chart_symbols

    syms = _chart_symbols(trade)
    contract, under = syms["contract_symbol"], syms["underlying_symbol"]

    candles = fetch_alert_candles(contract, "1d")
    on_contract = bool(candles)
    if not candles:
        candles = fetch_alert_candles(under, "1d")  # options may lack history -> spot
    if not candles:
        return None
    candles = candles[-130:]

    pnl, pct, ref = info["pnl"], info["pnl_pct"], info["ref_price"]
    color = "#16a34a" if pnl >= 0 else "#dc2626"
    shapes: list[dict] = []
    entry = float(trade.get("entry_price") or 0)
    if on_contract and entry:  # entry aligns with the charted instrument
        shapes.append({"type": "hline", "price": entry, "color": "#2563eb"})
    shapes.append({"type": "marker", "date": candles[-1]["date"], "price": float(ref), "color": color})

    sign = "+" if pnl >= 0 else "-"
    book = (trade.get("mode") or "actual").upper()
    title = f"{_label(trade)}  P&L {sign}{_inr(abs(pnl))} ({round(pct, 1)}%)  [{book}]"
    try:
        return render_pattern_png(_label(trade), candles, shapes, title)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Threshold alerts (profit / loss)
# ---------------------------------------------------------------------------
async def _elapsed_min(db, trade_id: int, kind: str, now: datetime) -> float:
    async with db.execute(
        "SELECT triggered_at FROM pnl_notifications WHERE trade_id=? AND kind=? ORDER BY id DESC LIMIT 1",
        [trade_id, kind],
    ) as cur:
        row = await cur.fetchone()
    if not row or not row[0]:
        return float("inf")
    try:
        last = datetime.fromisoformat(row[0])
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
    except Exception:
        return float("inf")
    return (now - last).total_seconds() / 60.0


async def _fire_threshold(db, trade: dict, info: dict, kind: str, now: datetime) -> None:
    from .telegram_service import send_message, send_photo
    from .routers.trades import _qty

    ts = now.isoformat(timespec="seconds")
    pnl, pct, ref = info["pnl"], info["pnl_pct"], info["ref_price"]
    emoji = "\U0001F7E2" if kind == "profit" else "\U0001F534"
    book = (trade.get("mode") or "actual").upper()
    sign = "+" if pnl >= 0 else "−"
    msg = (
        f"{emoji} <b>{html.escape(_label(trade))}</b> [{book}] "
        f"P&L {sign}₹{_inr(abs(pnl))} ({round(pct, 2)}%)\n"
        f"Entry {round(float(trade.get('entry_price') or 0), 2)} · "
        f"Now {round(ref, 2)} · Qty {_qty(trade)}"
    )
    res = await send_message(msg)
    delivered = 1 if res.get("ok") else 0
    err = res.get("error")
    if delivered:
        try:
            png = await asyncio.to_thread(render_trade_png, trade, info)
            if png:
                photo = await send_photo(png, caption="")
                if not photo.get("ok"):
                    err = err or f"chart: {photo.get('error')}"
        except Exception as exc:  # pragma: no cover - defensive
            err = err or f"chart: {exc}"
    await db.execute(
        "INSERT INTO pnl_notifications (trade_id, symbol, mode, kind, triggered_at, pnl, pnl_pct, price, message, delivered, error)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [trade["id"], _label(trade), trade.get("mode"), kind, ts, round(pnl, 2), round(pct, 2), round(ref, 2), msg, delivered, err],
    )


async def check_pnl() -> dict:
    """Evaluate every open position; fire profit/loss threshold alerts. Not
    market-gated itself — run_pnl_check() gates."""
    from .routers.trades import _TRADE_COLS, _pnl, _refresh_trade

    cfg = await get_config()
    if not cfg["enabled"]:
        return {"skipped": "disabled"}

    db_path = _get_db_path()
    cols = ", ".join(_TRADE_COLS)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f"SELECT {cols} FROM trades WHERE status='open'") as cur:
            trades = [{k: r[k] for k in _TRADE_COLS} for r in await cur.fetchall()]
    if not trades:
        return {"checked": 0, "fired": 0}

    fired = 0
    stale = 0
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        for t in trades:
            try:
                # Always evaluate on a FRESH price. If the live quote can't be
                # fetched (token down, illiquid contract), skip this position —
                # never fire a threshold alert on a stale cached P&L.
                price = await _refresh_trade(db, t)
                if price is None:
                    stale += 1
                    continue
                t["current_price"] = price
                info = _pnl(t)
                pnl = info["pnl"]
                now = datetime.now(timezone.utc)
                if pnl >= cfg["profit_threshold"]:
                    if await _elapsed_min(db, t["id"], "profit", now) >= cfg["profit_interval_min"]:
                        await _fire_threshold(db, t, info, "profit", now)
                        fired += 1
                elif pnl <= -abs(cfg["loss_threshold"]):
                    if await _elapsed_min(db, t["id"], "loss", now) >= cfg["loss_interval_min"]:
                        await _fire_threshold(db, t, info, "loss", now)
                        fired += 1
            except Exception:
                logger.exception("pnl check failed for trade %s", t.get("id"))
        await db.commit()
    return {"checked": len(trades), "fired": fired, "stale": stale}


async def run_pnl_check() -> dict:
    """Market-gated entry point used by the scheduler."""
    from .futures_scan import market_open
    is_open, reason = await market_open()
    if not is_open:
        return {"skipped": reason}
    return await check_pnl()


# ---------------------------------------------------------------------------
# End-of-day summary
# ---------------------------------------------------------------------------
async def _open_trades_priced() -> list[dict]:
    """All open trades (both books) with prices refreshed and P&L computed."""
    from .routers.trades import _TRADE_COLS, _pnl, _refresh_trade

    db_path = _get_db_path()
    cols = ", ".join(_TRADE_COLS)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT {cols} FROM trades WHERE status='open' ORDER BY mode, underlying, entry_at"
        ) as cur:
            trades = [{k: r[k] for k in _TRADE_COLS} for r in await cur.fetchall()]
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        for t in trades:
            fresh = False
            try:
                price = await _refresh_trade(db, t)
                if price is not None:
                    t["current_price"] = price
                    fresh = True
            except Exception:
                logger.exception("eod price refresh failed for trade %s", t.get("id"))
            t["_price_fresh"] = fresh  # so the summary can flag stale-priced rows
    for t in trades:
        t.update(_pnl(t))
    return trades


def _spot_changes(trades: list[dict]) -> dict:
    """underlying -> day change% from Fyers, for the summary's stock up/down %."""
    from .routers.trades import _underlying_symbol, _quotes_full
    sym_by_und = {t["underlying"]: _underlying_symbol(t) for t in trades if t.get("underlying")}
    quotes = _quotes_full(list(set(sym_by_und.values())))
    out: dict = {}
    for und, sym in sym_by_und.items():
        info = quotes.get(sym)
        if info:
            out[und] = {"lp": info.get("lp"), "chp": info.get("chp")}
    return out


async def run_eod_summary(force: bool = False) -> dict:
    """Send the daily P&L summary (both books) + a chart per open position, and a
    high-priority expiry warning. `force` bypasses the trading-day gate (manual)."""
    from .routers.holidays import get_holiday_set, is_trading_day
    from .telegram_service import send_message, send_photo

    holidays = await get_holiday_set()
    today = date.today()
    if not force and not is_trading_day(today, holidays):
        return {"skipped": "not a trading day"}

    cfg = await get_config()
    trades = await _open_trades_priced()
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if not trades:
        msg = f"\U0001F4CA <b>EOD P&L Summary</b> — {today.strftime('%d %b %Y')}\nNo open positions."
        res = await send_message(msg)
        await _log_eod(msg, 1 if res.get("ok") else 0, res.get("error"))
        return {"positions": 0, "delivered": res.get("ok")}

    spots = await asyncio.to_thread(_spot_changes, trades)

    # Build the text, grouped by book. Stamp the time so it's clear the P&L is live.
    now_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%H:%M")
    lines = [f"\U0001F4CA <b>EOD P&L Summary</b> — {today.strftime('%d %b %Y')} · as of {now_ist} IST"]
    expiring: list[tuple[dict, int]] = []
    grand = 0.0
    for book in ("actual", "paper"):
        group = [t for t in trades if (t.get("mode") or "actual") == book]
        if not group:
            continue
        lines.append(f"\n━ {book.upper()} ━")
        subtotal = 0.0
        for t in group:
            pnl, pct, ref = t["pnl"], t["pnl_pct"], t["ref_price"]
            subtotal += pnl
            grand += pnl
            sp = spots.get(t["underlying"], {})
            chp = sp.get("chp")
            spot_txt = f" · spot {round(sp['lp'], 2)} ({'▲' if (chp or 0) >= 0 else '▼'}{abs(round(chp or 0, 2))}%)" if sp.get("lp") is not None else ""
            sign = "+" if pnl >= 0 else "−"
            stale_txt = "" if t.get("_price_fresh", True) else " ⚠ stale price"
            hold = _hold_duration(t.get("entry_at"))
            edate = _entry_date_ist(t.get("entry_at"))
            exp_txt = ""
            td = trading_days_until(t.get("expiry_date"), holidays)
            if td is not None:
                exp_txt = f" · expiry in {td}td"
                if td <= cfg["expiry_trading_days"]:
                    expiring.append((t, td))
                    exp_txt = f" · ⚠ expiry in {td}td"
            lines.append(
                f"• <b>{html.escape(_label(t))}</b> {t.get('side', '').upper()} ×{int(t.get('num_lots') or 1)}\n"
                f"   P&L {sign}₹{_inr(abs(pnl))} ({round(pct, 2)}%){stale_txt} · entry {round(float(t.get('entry_price') or 0), 2)} → {round(ref, 2)}{spot_txt}\n"
                f"   held {hold} (since {edate}){exp_txt}"
            )
        lines.append(f"   <i>Subtotal ({book}): {'+' if subtotal >= 0 else '−'}₹{_inr(abs(subtotal))}</i>")

    lines.append(f"\n<b>Net (both books): {'+' if grand >= 0 else '−'}₹{_inr(abs(grand))}</b>")
    summary = "\n".join(lines)
    res = await send_message(summary)
    delivered = 1 if res.get("ok") else 0
    await _log_eod(summary, delivered, res.get("error"))

    # High-priority expiry warning (its own message so it stands out).
    if expiring:
        warn = ["⚠️ <b>CLOSE SOON</b> — positions near expiry:"]
        for t, td in expiring:
            book = (t.get("mode") or "actual").upper()
            warn.append(f"• <b>{html.escape(_label(t))}</b> [{book}] — {td} trading day(s) to expiry")
        wmsg = "\n".join(warn)
        wres = await send_message(wmsg)
        async with aiosqlite.connect(_get_db_path()) as db:
            for t, td in expiring:
                await db.execute(
                    "INSERT INTO pnl_notifications (trade_id, symbol, mode, kind, triggered_at, pnl, pnl_pct, price, message, delivered, error)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    [t["id"], _label(t), t.get("mode"), "expiry", ts, t.get("pnl"), t.get("pnl_pct"),
                     t.get("ref_price"), f"{td}td to expiry", 1 if wres.get("ok") else 0, wres.get("error")],
                )
            await db.commit()

    # A chart per open position.
    charts = 0
    for t in trades:
        try:
            png = await asyncio.to_thread(render_trade_png, t, {"pnl": t["pnl"], "pnl_pct": t["pnl_pct"], "ref_price": t["ref_price"]})
            if png:
                cap = f"{_label(t)} [{(t.get('mode') or 'actual').upper()}]"
                if (await send_photo(png, caption=cap)).get("ok"):
                    charts += 1
        except Exception:
            logger.exception("eod chart failed for trade %s", t.get("id"))

    return {"positions": len(trades), "delivered": bool(delivered), "charts": charts, "expiring": len(expiring)}


async def _log_eod(message: str, delivered: int, error) -> None:
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    async with aiosqlite.connect(_get_db_path()) as db:
        await db.execute(
            "INSERT INTO pnl_notifications (trade_id, symbol, mode, kind, triggered_at, pnl, pnl_pct, price, message, delivered, error)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [None, None, None, "eod", ts, None, None, None, message, delivered, error],
        )
        await db.commit()
