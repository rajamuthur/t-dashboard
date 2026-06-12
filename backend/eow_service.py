"""
End-of-Week (EOW) scan service.

Fetches the current week's live candles from Fyers, forms a weekly OHLCV bar,
runs the scanner against the last 3 weekly candles (C1, C2 = previous 2 weeks
from DB, C3 = live current week), and sends notifications on match.

A record with is_eow_alert=1 is upserted per (symbol, timeframe, analysis_type,
candle_date) so re-running at 3:20 PM updates the same row.
"""
import asyncio
import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import aiosqlite
import pandas as pd

from .db import _get_db_path
from .downloaders.fyers import FyersDownloader
from .notifications import notify_signals
from .routers.holidays import get_holiday_set, get_last_trading_day_of_week
from .scanners.registry import get_scanner, list_analysis_types

_eow_status: dict = {"status": "idle", "last_run": None, "message": ""}


def get_eow_status() -> dict:
    return dict(_eow_status)


def _week_monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _week_friday(d: date) -> date:
    return d + timedelta(days=(4 - d.weekday()))


async def run_eow_scan(triggered_by: str = "manual") -> dict:
    """
    Main EOW scan entry point.
    1. Determine current week's Mon-Fri range.
    2. For each weekly stock: fetch live intraday (daily resolution) data for this week.
    3. Build a provisional weekly candle (OHLCV aggregate).
    4. Prepend the last 2 complete weekly candles from DB to form a 3-candle window.
    5. Run all registered scanners.
    6. Upsert results with is_eow_alert=1.
    7. Send notifications for matches.
    """
    global _eow_status
    _eow_status = {"status": "running", "message": "Starting EOW scan...", "last_run": None}

    db_path = _get_db_path()
    today   = date.today()
    holidays = await get_holiday_set()
    week_mon = _week_monday(today)
    week_fri = _week_friday(today)
    # Use the actual last trading day as the provisional candle_date
    last_td  = get_last_trading_day_of_week(today, holidays)
    candle_date_str = last_td.isoformat()

    scanned_at = datetime.now(timezone.utc).isoformat()
    downloader = FyersDownloader()
    matched_signals: list[dict] = []

    async with aiosqlite.connect(db_path) as db:
        # Load stock list
        async with db.execute(
            "SELECT value FROM config WHERE key='weekly_stocks'"
        ) as cur:
            row = await cur.fetchone()
        stocks: list[str] = json.loads(row[0]) if row else []

        if not stocks:
            _eow_status = {"status": "error", "message": "No weekly stocks configured", "last_run": scanned_at}
            return _eow_status

        _eow_status["message"] = f"Scanning {len(stocks)} stocks..."
        total = len(stocks)

        for i, symbol in enumerate(stocks):
            _eow_status["message"] = f"[{i+1}/{total}] {symbol}"

            # --- Fetch live intraday data for this week ---
            start_str = week_mon.isoformat()
            end_str   = today.isoformat()
            try:
                daily_df = await asyncio.to_thread(
                    downloader.fetch_daily, symbol, start_str, end_str
                )
            except Exception:
                continue

            if daily_df is None or daily_df.empty:
                continue

            # Build provisional weekly candle
            try:
                live_candle = pd.Series({
                    "open":   float(daily_df["open"].iloc[0]),
                    "high":   float(daily_df["high"].max()),
                    "low":    float(daily_df["low"].min()),
                    "close":  float(daily_df["close"].iloc[-1]),
                    "volume": int(daily_df["volume"].sum()),
                })
            except Exception:
                continue

            # --- Fetch last 2 complete weekly candles from DB ---
            async with db.execute(
                "SELECT date,open,high,low,close,volume FROM candles"
                " WHERE symbol=? AND timeframe='week' AND date<?"
                " ORDER BY date DESC LIMIT 2",
                [symbol, candle_date_str],
            ) as cur:
                prev_rows = list(reversed(await cur.fetchall()))

            if len(prev_rows) < 2:
                continue  # not enough history for 3-candle pattern

            cols = ["date", "open", "high", "low", "close", "volume"]
            df = pd.DataFrame(
                [list(r) for r in prev_rows]
                + [[candle_date_str,
                    live_candle["open"], live_candle["high"],
                    live_candle["low"],  live_candle["close"],
                    live_candle["volume"]]],
                columns=cols,
            ).set_index("date")

            for atype in list_analysis_types():
                scanner = get_scanner(atype)
                try:
                    result = await asyncio.to_thread(scanner.run, symbol, "week", df)
                except Exception:
                    continue

                if not result.matched:
                    continue

                details_json = json.dumps(result.details) if result.details else None

                # Upsert — update if record for this week already exists
                async with db.execute(
                    "SELECT id FROM scan_results"
                    " WHERE symbol=? AND timeframe='week' AND analysis_type=?"
                    "   AND candle_date=? AND is_eow_alert=1",
                    [symbol, atype, candle_date_str],
                ) as cur:
                    existing = await cur.fetchone()

                if existing:
                    await db.execute(
                        "UPDATE scan_results SET scanned_at=?, details=?, matched=1"
                        " WHERE id=?",
                        [scanned_at, details_json, existing[0]],
                    )
                else:
                    await db.execute(
                        """INSERT INTO scan_results
                           (symbol, timeframe, analysis_type, scanned_at,
                            matched, details, candle_date, is_eow_alert)
                           VALUES (?, 'week', ?, ?, 1, ?, ?, 1)""",
                        [symbol, atype, scanned_at, details_json, candle_date_str],
                    )

                d = result.details or {}
                matched_signals.append({
                    "symbol":      symbol,
                    "candle_date": candle_date_str,
                    "entry_close": d.get("entry_close"),
                    "stop_loss":   d.get("stop_loss"),
                    "analysis_type": atype,
                })

        await db.commit()

    # --- Send notifications ---
    notify_result = {"email": {"ok": True, "skipped": True},
                     "whatsapp": {"ok": True, "skipped": True}}
    if matched_signals:
        try:
            notify_result = await notify_signals(matched_signals)
        except Exception as exc:
            notify_result = {"error": str(exc)}

    msg = (
        f"EOW scan complete: {len(matched_signals)} match(es) on {candle_date_str}"
        if matched_signals else
        f"EOW scan complete: no matches found for week of {candle_date_str}"
    )
    _eow_status = {
        "status":          "success",
        "message":         msg,
        "last_run":        scanned_at,
        "matched":         len(matched_signals),
        "signals":         matched_signals,
        "triggered_by":    triggered_by,
        "notify_result":   notify_result,
    }
    return _eow_status
