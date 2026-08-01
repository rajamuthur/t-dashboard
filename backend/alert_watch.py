"""
Alert evaluation: compute a line's value at 'now', detect LTP crossings, fire to
Telegram, and log every fire with delivery status.

Horizontal alert -> constant `price`. Trend alert -> the line through the two
anchors (t1,p1)-(t2,p2), extended to the right, evaluated at the current time.
A cross is a sign change of (LTP - line_value) between checks, so a moving
trendline threshold is handled correctly. `once` alerts fire then go Triggered;
`recurring` alerts stay active and fire again on every re-cross.
"""
import asyncio
import html
from datetime import datetime, timezone

import aiosqlite

from .db import _get_db_path


def line_value(alert: dict, now_unix: float) -> float | None:
    if alert.get("kind") == "horizontal":
        return alert.get("price")
    t1, p1, t2, p2 = alert.get("t1"), alert.get("p1"), alert.get("t2"), alert.get("p2")
    if None in (t1, p1, t2, p2):
        return None
    if t2 == t1:
        return p2
    return p1 + (p2 - p1) * (now_unix - t1) / (t2 - t1)


def _short(sym: str) -> str:
    return sym.replace("NSE:", "").replace("-EQ", "")


async def check_alerts() -> dict:
    """Evaluate every active alert against live LTP; fire crossings. Not market-
    gated itself — callers (scheduler / startup) use run_alert_check()."""
    db_path = _get_db_path()
    now = datetime.now(timezone.utc)
    now_unix = now.timestamp()
    ts = now.isoformat(timespec="seconds")

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM alerts WHERE status='active'") as cur:
            alerts = [dict(r) for r in await cur.fetchall()]
    if not alerts:
        return {"checked": 0, "fired": 0}

    symbols = sorted({a["symbol"] for a in alerts})
    from .downloaders.fyers import FyersDownloader
    quotes = await asyncio.to_thread(lambda: FyersDownloader().quotes_full(symbols))

    fired = 0
    async with aiosqlite.connect(db_path) as db:
        for a in alerts:
            q = quotes.get(a["symbol"])
            if not q or q.get("lp") is None:
                continue
            ltp = float(q["lp"])
            level = line_value(a, now_unix)
            if level is None:
                continue
            diff = ltp - level
            prev = a.get("last_diff")
            direction = None
            if prev is not None:
                if a["condition"] == "cross_up" and prev < 0 <= diff:
                    direction = "up"
                elif a["condition"] == "cross_down" and prev > 0 >= diff:
                    direction = "down"
            await db.execute("UPDATE alerts SET last_diff=? WHERE id=?", [diff, a["id"]])
            if direction:
                fired += 1
                await _fire(db, a, ltp, level, direction, ts)
        await db.commit()
    return {"checked": len(alerts), "fired": fired}


async def _fire(db, a: dict, ltp: float, level: float, direction: str, ts: str) -> None:
    from .telegram_service import send_message
    arrow = "\U0001F53C" if direction == "up" else "\U0001F53D"
    header = f"\U0001F514 <b>{html.escape(_short(a['symbol']))}</b> {arrow} crossed " \
             f"{'above' if direction == 'up' else 'below'} {round(level, 2)} (LTP {round(ltp, 2)})"
    body = f"\n<i>{html.escape(a['name'])}</i>" if a.get("name") else ""
    msg = header + body
    res = await send_message(msg)
    delivered = 1 if res.get("ok") else 0
    await db.execute(
        "INSERT INTO alert_notifications (alert_id, symbol, triggered_at, price, line_value, direction, message, delivered, error)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        [a["id"], a["symbol"], ts, round(ltp, 2), round(level, 2), direction, msg, delivered, res.get("error")],
    )
    if a.get("repeat_mode") == "once":
        await db.execute("UPDATE alerts SET status='triggered', triggered_at=? WHERE id=?", [ts, a["id"]])
    else:
        await db.execute("UPDATE alerts SET triggered_at=? WHERE id=?", [ts, a["id"]])


async def run_alert_check() -> dict:
    """Market-gated entry point used by the scheduler and on startup."""
    from .futures_scan import market_open
    is_open, reason = await market_open()
    if not is_open:
        return {"skipped": reason}
    return await check_alerts()
