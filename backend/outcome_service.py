"""
Outcome evaluation for scan_results.

Logic (lookahead): scan candles after C3 in chronological order.
  - First candle where low < stop_loss  -> 'failure'
  - First candle where close > entry_close -> 'success'
  - If candle period not yet closed (current period still open) -> 'pending'
  - If no subsequent candles exist -> 'open'
"""
import json
from datetime import datetime, timezone, timedelta
from typing import Optional

import aiosqlite
import pandas as pd

from .db import DB_PATH


def _period_closed(candle_date_str: str, timeframe: str) -> bool:
    """Return True if the candle period after candle_date has already closed."""
    try:
        cd = pd.Timestamp(candle_date_str).date()
    except Exception:
        return True
    today = datetime.now(timezone.utc).date()
    if timeframe == "week":
        # Next weekly candle closes on the Friday after candle_date
        days_ahead = (4 - cd.weekday()) % 7 or 7  # days until next Friday
        next_close = cd + timedelta(days=days_ahead)
    elif timeframe == "month":
        # Next monthly candle closes at end of following month
        if cd.month == 12:
            next_close = cd.replace(year=cd.year + 1, month=1, day=31)
        else:
            import calendar
            last_day = calendar.monthrange(cd.year, cd.month + 1)[1]
            next_close = cd.replace(month=cd.month + 1, day=last_day)
    else:
        next_close = cd + timedelta(days=1)
    return today > next_close


async def evaluate_outcome(scan_id: int) -> dict:
    """Evaluate and persist outcome for one scan_result row. Returns updated row dict."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM scan_results WHERE id=?", [scan_id]
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return {"error": "not found"}

        row = dict(row)
        details = json.loads(row["details"]) if row["details"] else {}
        stop_loss = details.get("stop_loss")
        entry_close = details.get("entry_close")
        candle_date = row["candle_date"]
        timeframe = row["timeframe"]
        symbol = row["symbol"]

        if not stop_loss or not entry_close or not candle_date:
            return row

        # Fetch candles after C3
        async with db.execute(
            "SELECT date, open, high, low, close FROM candles"
            " WHERE symbol=? AND timeframe=? AND date > ? ORDER BY date ASC",
            [symbol, timeframe, candle_date],
        ) as cur:
            subsequent = await cur.fetchall()

        outcome = None
        outcome_price = None
        outcome_date = None

        for c in subsequent:
            cdate, o, h, l, cls = c
            if l < stop_loss:
                outcome = "failure"
                outcome_price = stop_loss
                outcome_date = cdate
                break
            if cls > entry_close:
                outcome = "success"
                outcome_price = round(float(cls), 2)
                outcome_date = cdate
                break

        if outcome is None:
            outcome = "pending" if not _period_closed(candle_date, timeframe) else "open"

        await db.execute(
            "UPDATE scan_results SET outcome=?, outcome_price=?, outcome_date=? WHERE id=?",
            [outcome, outcome_price, outcome_date, scan_id],
        )
        await db.commit()
        row.update({"outcome": outcome, "outcome_price": outcome_price, "outcome_date": outcome_date})
        return row


async def evaluate_all_outcomes() -> int:
    """Evaluate outcomes for all scan_results that don't have one yet. Returns count updated."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id FROM scan_results WHERE outcome IS NULL") as cur:
            ids = [r[0] for r in await cur.fetchall()]
    count = 0
    for scan_id in ids:
        await evaluate_outcome(scan_id)
        count += 1
    return count
