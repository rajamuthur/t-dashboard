import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiosqlite
import pandas as pd

from .db import _get_db_path
from .downloaders.fyers import FyersDownloader
from .scanners.registry import get_scanner, list_analysis_types

_status: dict = {}

# Config table stock-list keys are `weekly_stocks` / `monthly_stocks` /
# `daily_stocks` (see db.py::_seed_default_config), not `week_stocks` etc.
# Map the timeframe argument to the actual key.
_STOCKS_CONFIG_KEY = {
    "week":  "weekly_stocks",
    "month": "monthly_stocks",
    "day":   "daily_stocks",
}


def get_sync_status(timeframe: Optional[str] = None) -> dict:
    if timeframe:
        return _status.get(timeframe, {"status": "idle"})
    return dict(_status)


async def run_sync(timeframe: str) -> dict:
    _status[timeframe] = {"status": "running", "current": 0, "total": 0, "message": "Starting..."}
    started_at = datetime.now(timezone.utc).isoformat()
    db_path = _get_db_path()

    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute(
            "INSERT INTO sync_log (timeframe, started_at, status) VALUES (?, ?, 'running')",
            [timeframe, started_at],
        )
        log_id = cur.lastrowid
        await db.commit()

        try:
            stocks_key = _STOCKS_CONFIG_KEY.get(timeframe, f"{timeframe}_stocks")
            async with db.execute("SELECT value FROM config WHERE key=?", [stocks_key]) as c:
                row = await c.fetchone()
            stocks: list[str] = json.loads(row[0]) if row else []

            if not stocks:
                msg = f"No stocks configured for timeframe '{timeframe}'"
                _status[timeframe] = {"status": "error", "message": msg}
                await db.execute(
                    "UPDATE sync_log SET status='error', finished_at=?, message=? WHERE id=?",
                    [datetime.now(timezone.utc).isoformat(), msg, log_id],
                )
                await db.commit()
                return {"status": "error", "message": msg}

            _status[timeframe]["total"] = len(stocks)
            today = datetime.today().strftime("%Y-%m-%d")
            downloader = FyersDownloader()
            saved_rows = 0
            data_from: str | None = None
            data_to:   str | None = None

            for i, symbol in enumerate(stocks):
                _status[timeframe].update({"current": i + 1, "message": f"Fetching {symbol}"})

                async with db.execute(
                    "SELECT MAX(date) FROM candles WHERE symbol=? AND timeframe=?",
                    [symbol, timeframe],
                ) as c:
                    last = (await c.fetchone())[0]

                start = (
                    (pd.Timestamp(last) + timedelta(days=1)).strftime("%Y-%m-%d")
                    if last
                    else os.getenv(
                        "START_WEEK_DATE" if timeframe == "week" else "START_MONTH_DATE",
                        "2025-01-01",
                    )
                )
                if start > today:
                    continue

                daily = await asyncio.to_thread(downloader.fetch_daily, symbol, start, today)
                if daily.empty:
                    continue

                if timeframe == "week":
                    candles = await asyncio.to_thread(FyersDownloader.resample_weekly, daily)
                elif timeframe == "month":
                    candles = await asyncio.to_thread(FyersDownloader.resample_monthly, daily)
                else:
                    candles = daily

                if candles.empty:
                    continue

                for idx, r in candles.iterrows():
                    date_str = pd.Timestamp(idx).strftime("%Y-%m-%d")
                    await db.execute(
                        """INSERT INTO candles (symbol, timeframe, date, open, high, low, close, volume)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(symbol, timeframe, date) DO UPDATE SET
                             open=excluded.open, high=excluded.high,
                             low=excluded.low,   close=excluded.close,
                             volume=excluded.volume""",
                        [symbol, timeframe, date_str,
                         float(r["open"]), float(r["high"]),
                         float(r["low"]),  float(r["close"]),
                         int(r["volume"])],
                    )
                    saved_rows += 1
                    if data_from is None or date_str < data_from:
                        data_from = date_str
                    if data_to is None or date_str > data_to:
                        data_to = date_str

            await db.commit()

            _status[timeframe]["message"] = "Running scanners..."
            scanned_at = datetime.now(timezone.utc).isoformat()

            async with db.execute(
                "SELECT DISTINCT symbol FROM candles WHERE timeframe=?", [timeframe]
            ) as c:
                all_symbols = [r[0] for r in await c.fetchall()]

            for atype in list_analysis_types():
                scanner = get_scanner(atype)
                for symbol in all_symbols:
                    async with db.execute(
                        "SELECT date, open, high, low, close, volume FROM candles"
                        " WHERE symbol=? AND timeframe=? ORDER BY date ASC",
                        [symbol, timeframe],
                    ) as c:
                        rows = await c.fetchall()
                    if not rows:
                        continue
                    df = pd.DataFrame(
                        list(rows),
                        columns=["date", "open", "high", "low", "close", "volume"],
                    ).set_index("date")
                    history = await asyncio.to_thread(scanner.scan_history, symbol, timeframe, df)
                    for result in history:
                        async with db.execute(
                            "SELECT 1 FROM scan_results WHERE symbol=? AND timeframe=? AND analysis_type=? AND candle_date=?",
                            [symbol, timeframe, atype, result.candle_date],
                        ) as c:
                            exists = await c.fetchone()
                        if not exists:
                            await db.execute(
                                """INSERT INTO scan_results
                                   (symbol, timeframe, analysis_type, scanned_at, matched, details, candle_date)
                                   VALUES (?, ?, ?, ?, 1, ?, ?)""",
                                [symbol, timeframe, atype, scanned_at,
                                 json.dumps(result.details) if result.details else None,
                                 result.candle_date],
                            )
            await db.commit()

            msg = f"Synced {saved_rows} rows, scanned {len(all_symbols)} stocks"
            await db.execute(
                "UPDATE sync_log SET status='success', finished_at=?, message=?, rows_saved=?, stocks_scanned=?, data_from=?, data_to=? WHERE id=?",
                [datetime.now(timezone.utc).isoformat(), msg, saved_rows, len(all_symbols), data_from, data_to, log_id],
            )
            await db.commit()
            _status[timeframe] = {"status": "success", "message": msg}
            return {"status": "success", "message": msg}

        except Exception as exc:
            err = str(exc)
            await db.execute(
                "UPDATE sync_log SET status='error', finished_at=?, message=? WHERE id=?",
                [datetime.now(timezone.utc).isoformat(), err, log_id],
            )
            await db.commit()
            _status[timeframe] = {"status": "error", "message": err}
            raise
