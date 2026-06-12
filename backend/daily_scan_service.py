import asyncio
import json
from datetime import datetime, timedelta, timezone

import aiosqlite
import pandas as pd

from .db import _get_db_path
from .downloaders.fyers import FyersDownloader
from .fno_service import get_fo_stocks
from .scanners.registry import get_scanner

# In-memory status for the running scan (polled by frontend)
_scan_status: dict = {}


def get_scan_status() -> dict:
    return dict(_scan_status)


async def run_daily_pattern_scan(analysis_type: str = "tight_range") -> dict:
    """
    Full pipeline: fetch F&O list → sync daily candles → run scanner → store results.
    All candle data and results are stored datewise so repeated runs skip already-fetched data.
    """
    global _scan_status
    db_path = _get_db_path()
    started_at = datetime.now(timezone.utc).isoformat()
    scan_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    _scan_status = {"status": "running", "step": "Fetching F&O list...", "matched": 0, "total": 0}

    # Create session record
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute(
            "INSERT INTO daily_scan_sessions (analysis_type, scan_date, started_at, status)"
            " VALUES (?, ?, ?, 'running')",
            [analysis_type, scan_date, started_at],
        )
        session_id = cur.lastrowid
        await db.commit()

    try:
        stocks = await get_fo_stocks()
        _scan_status.update({"step": f"Syncing candles for {len(stocks)} stocks...", "total": len(stocks)})

        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "UPDATE daily_scan_sessions SET total_stocks=? WHERE id=?",
                [len(stocks), session_id],
            )
            await db.commit()

        await _sync_daily_candles(stocks, db_path)

        _scan_status["step"] = "Running scanner..."
        scanner = get_scanner(analysis_type)
        matched_count = await _run_scanner(scanner, stocks, analysis_type, session_id, db_path)

        finished_at = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "UPDATE daily_scan_sessions SET status='completed', finished_at=?, matched_count=? WHERE id=?",
                [finished_at, matched_count, session_id],
            )
            await db.commit()

        _scan_status = {
            "status": "completed",
            "session_id": session_id,
            "matched": matched_count,
            "total": len(stocks),
            "scan_date": scan_date,
        }
        return _scan_status

    except Exception as exc:
        err = str(exc)
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "UPDATE daily_scan_sessions SET status='failed', finished_at=?, message=? WHERE id=?",
                [datetime.now(timezone.utc).isoformat(), err, session_id],
            )
            await db.commit()
        _scan_status = {"status": "failed", "message": err}
        raise


async def _sync_daily_candles(stocks: list[str], db_path: str) -> None:
    """Sync daily candles for all stocks. Only fetches dates not already in DB."""
    downloader = FyersDownloader()
    today = datetime.now().strftime("%Y-%m-%d")
    # 90 calendar days ≈ 60 trading days — enough for tight range (30 candles)
    default_start = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    async with aiosqlite.connect(db_path) as db:
        for i, symbol in enumerate(stocks):
            _scan_status["step"] = f"Syncing {symbol} ({i + 1}/{len(stocks)})"

            async with db.execute(
                "SELECT MAX(date) FROM candles WHERE symbol=? AND timeframe='day'",
                [symbol],
            ) as cur:
                row = await cur.fetchone()

            last_date = row[0] if row and row[0] else None
            start = (
                (pd.Timestamp(last_date) + timedelta(days=1)).strftime("%Y-%m-%d")
                if last_date
                else default_start
            )
            if start > today:
                continue

            daily = await asyncio.to_thread(downloader.fetch_daily, symbol, start, today)
            if daily.empty:
                continue

            for idx, r in daily.iterrows():
                date_str = pd.Timestamp(idx).strftime("%Y-%m-%d")
                await db.execute(
                    """INSERT INTO candles (symbol, timeframe, date, open, high, low, close, volume)
                       VALUES (?, 'day', ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(symbol, timeframe, date) DO UPDATE SET
                         open=excluded.open, high=excluded.high,
                         low=excluded.low,  close=excluded.close,
                         volume=excluded.volume""",
                    [symbol, date_str,
                     float(r["open"]), float(r["high"]),
                     float(r["low"]),  float(r["close"]),
                     int(r["volume"])],
                )
        await db.commit()


async def _run_scanner(scanner, stocks: list[str], analysis_type: str, session_id: int, db_path: str) -> int:
    """Run scanner on each stock's daily candles; persist matched results."""
    scanned_at = datetime.now(timezone.utc).isoformat()
    matched = 0

    async with aiosqlite.connect(db_path) as db:
        for symbol in stocks:
            async with db.execute(
                "SELECT date, open, high, low, close, volume FROM candles"
                " WHERE symbol=? AND timeframe='day' ORDER BY date ASC",
                [symbol],
            ) as cur:
                rows = await cur.fetchall()

            if len(rows) < scanner.window_size:
                continue

            df = pd.DataFrame(
                list(rows),
                columns=["date", "open", "high", "low", "close", "volume"],
            ).set_index("date")

            result = await asyncio.to_thread(scanner.run, symbol, "day", df)
            if not result.matched:
                continue

            # Dedup by symbol + analysis_type + candle_date
            async with db.execute(
                "SELECT id FROM scan_results"
                " WHERE symbol=? AND timeframe='day' AND analysis_type=? AND candle_date=?",
                [symbol, analysis_type, result.candle_date],
            ) as cur:
                existing = await cur.fetchone()

            if existing:
                await db.execute(
                    "UPDATE scan_results SET session_id=? WHERE id=? AND (session_id IS NULL OR session_id != ?)",
                    [session_id, existing[0], session_id],
                )
            else:
                await db.execute(
                    """INSERT INTO scan_results
                       (symbol, timeframe, analysis_type, scanned_at, matched,
                        details, candle_date, session_id)
                       VALUES (?, 'day', ?, ?, 1, ?, ?, ?)""",
                    [symbol, analysis_type, scanned_at,
                     json.dumps(result.details) if result.details else None,
                     result.candle_date, session_id],
                )
            matched += 1

        await db.commit()

    _scan_status["matched"] = matched
    return matched
