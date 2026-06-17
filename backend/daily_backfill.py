"""
Daily-candle backfill + top-up via yfinance (free, no auth).

Used because the Fyers token path needs interactive re-auth; yfinance gives
~5 years of daily OHLCV for NSE stocks with no token. Fyers stays available for
when it's re-authenticated, but the pattern flow no longer depends on it.
"""
import sqlite3
from datetime import datetime, timedelta
from typing import List, Optional

import pandas as pd

_UPSERT_SQL = (
    "INSERT INTO candles (symbol, timeframe, date, open, high, low, close, volume) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(symbol, timeframe, date) DO UPDATE SET "
    "open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume"
)


def backfill_intraday_fyers(db_path: str, stocks: List[str], resolution: str = "5",
                            timeframe: str = "5m", days_back: int = 365,
                            status: Optional[dict] = None) -> dict:
    """Deep intraday backfill via Fyers (yfinance caps intraday at ~60 days).

    Pages history in 100-day chunks (Fyers' per-request intraday limit) back
    `days_back` days and upserts into candles. Needs a valid Fyers token.
    """
    from .downloaders.fyers import FyersDownloader
    d = FyersDownloader()
    con = sqlite3.connect(db_path)
    today = datetime.now()
    start_all = today - timedelta(days=days_back)
    ok = skipped = rows = 0
    total = len(stocks)
    for i, sym in enumerate(stocks):
        if status is not None:
            status["step"] = f"{sym} {timeframe} ({i + 1}/{total})"
        got = 0
        cur = start_all
        while cur < today:
            chunk_end = min(cur + timedelta(days=99), today)
            try:
                df = d.fetch_daily(sym, cur.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d"), resolution=resolution)
            except Exception:
                df = pd.DataFrame()
            if df is not None and not df.empty:
                batch = [
                    (sym, timeframe, pd.Timestamp(ts).strftime("%Y-%m-%d %H:%M:%S"),
                     float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]),
                     int(r.get("volume", 0) or 0))
                    for ts, r in df.iterrows()
                ]
                con.executemany(_UPSERT_SQL, batch)
                con.commit()
                got += len(batch)
            cur = chunk_end + timedelta(days=1)
        if got:
            ok += 1; rows += got
        else:
            skipped += 1
    con.close()
    return {"symbols_ok": ok, "skipped": skipped, "rows": rows, "timeframe": timeframe}

# Index symbols that don't follow the SYMBOL.NS convention.
_INDEX_MAP = {
    "NSE:NIFTY50-INDEX": "^NSEI",
    "NSE:NIFTY-INDEX": "^NSEI",
    "NSE:NIFTYBANK-INDEX": "^NSEBANK",
    "NSE:BANKNIFTY-INDEX": "^NSEBANK",
    "NSE:FINNIFTY-INDEX": "^CNXFIN",
}

_backfill_status: dict = {}


def get_backfill_status() -> dict:
    return dict(_backfill_status)


def nse_to_yahoo(symbol: str) -> Optional[str]:
    """Map 'NSE:RELIANCE-EQ' -> 'RELIANCE.NS'. Returns None if unmappable."""
    if symbol in _INDEX_MAP:
        return _INDEX_MAP[symbol]
    s = symbol
    if s.startswith("NSE:"):
        s = s[4:]
    if s.endswith("-EQ"):
        return f"{s[:-3]}.NS"
    if s.endswith("-INDEX"):
        return None  # unknown index — skip
    return f"{s}.NS"


# yfinance interval + lookback period per app timeframe. 4h is resampled from 1h
# (yfinance has no native 4h). Intraday history is capped by Yahoo.
_TF_YF = {
    "day":  ("1d", "5y"),
    "week": ("1wk", "10y"),
    "month": ("1mo", "max"),
    "5m":   ("5m", "60d"),
    "15m":  ("15m", "60d"),
    "30m":  ("30m", "60d"),
    "1h":   ("60m", "730d"),
    "4h":   ("60m", "730d"),   # fetched as 1h then resampled to 4h
}


def fetch_candles_yf(yahoo_symbol: str, timeframe: str):
    """Return a DataFrame (Open/High/Low/Close/Volume) for the given app timeframe."""
    import yfinance as yf
    interval, period = _TF_YF.get(timeframe, ("1d", "5y"))
    df = yf.Ticker(yahoo_symbol).history(period=period, interval=interval, auto_adjust=False)
    if df is None or df.empty:
        return None
    if timeframe == "4h":
        df = df.resample("4h").agg({"Open": "first", "High": "max", "Low": "min",
                                    "Close": "last", "Volume": "sum"}).dropna(subset=["Open"])
    return df


def _row_key(ts, intraday: bool) -> str:
    t = pd.Timestamp(ts)
    return t.strftime("%Y-%m-%d %H:%M:%S") if intraday else t.strftime("%Y-%m-%d")


def backfill_timeframe(db_path: str, stocks: List[str], timeframe: str,
                       status: Optional[dict] = None) -> dict:
    """Fetch candles for a given timeframe (incl. intraday) via yfinance and upsert."""
    con = sqlite3.connect(db_path)
    rows_saved = ok = skipped = 0
    intraday = timeframe not in ("day", "week", "month")
    total = len(stocks)
    for i, sym in enumerate(stocks):
        if status is not None:
            status["step"] = f"{sym} {timeframe} ({i + 1}/{total})"
        yh = nse_to_yahoo(sym)
        if not yh:
            skipped += 1
            continue
        try:
            df = fetch_candles_yf(yh, timeframe)
        except Exception:
            skipped += 1
            continue
        if df is None or df.empty:
            skipped += 1
            continue
        batch = []
        for ts, r in df.iterrows():
            try:
                batch.append((sym, timeframe, _row_key(ts, intraday),
                              float(r["Open"]), float(r["High"]), float(r["Low"]),
                              float(r["Close"]), int(r.get("Volume", 0) or 0)))
            except Exception:
                continue
        if not batch:
            skipped += 1
            continue
        con.executemany(
            """INSERT INTO candles (symbol, timeframe, date, open, high, low, close, volume)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(symbol, timeframe, date) DO UPDATE SET
                 open=excluded.open, high=excluded.high, low=excluded.low,
                 close=excluded.close, volume=excluded.volume""",
            batch,
        )
        con.commit()
        rows_saved += len(batch)
        ok += 1
    con.close()
    return {"symbols_ok": ok, "skipped": skipped, "rows": rows_saved, "total": total, "timeframe": timeframe}


def backfill_daily(db_path: str, stocks: List[str], period: str = "5y",
                   status: Optional[dict] = None) -> dict:
    """Fetch `period` of daily candles per stock via yfinance and upsert into
    candles(timeframe='day'). Idempotent. Synchronous (call via asyncio.to_thread)."""
    import yfinance as yf

    con = sqlite3.connect(db_path)
    rows_saved = 0
    ok = 0
    skipped = 0
    total = len(stocks)
    for i, sym in enumerate(stocks):
        if status is not None:
            status["step"] = f"{sym} ({i + 1}/{total})"
        yh = nse_to_yahoo(sym)
        if not yh:
            skipped += 1
            continue
        try:
            df = yf.Ticker(yh).history(period=period, interval="1d", auto_adjust=False)
        except Exception:
            skipped += 1
            continue
        if df is None or df.empty:
            skipped += 1
            continue
        batch = []
        for ts, r in df.iterrows():
            try:
                d = pd.Timestamp(ts).strftime("%Y-%m-%d")
                batch.append((sym, "day", d, float(r["Open"]), float(r["High"]),
                              float(r["Low"]), float(r["Close"]), int(r.get("Volume", 0) or 0)))
            except Exception:
                continue
        if not batch:
            skipped += 1
            continue
        con.executemany(
            """INSERT INTO candles (symbol, timeframe, date, open, high, low, close, volume)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(symbol, timeframe, date) DO UPDATE SET
                 open=excluded.open, high=excluded.high, low=excluded.low,
                 close=excluded.close, volume=excluded.volume""",
            batch,
        )
        con.commit()
        rows_saved += len(batch)
        ok += 1
    con.close()
    return {"symbols_ok": ok, "skipped": skipped, "rows": rows_saved, "total": total}


async def run_backfill(stocks: List[str], period: str = "5y") -> dict:
    """Async wrapper for the background-task endpoint."""
    import asyncio
    from .db import _get_db_path
    global _backfill_status
    _backfill_status = {"status": "running", "step": "Starting...", "total": len(stocks)}
    try:
        res = await asyncio.to_thread(backfill_daily, _get_db_path(), stocks, period, _backfill_status)
        _backfill_status = {"status": "completed", **res}
        return _backfill_status
    except Exception as exc:
        _backfill_status = {"status": "failed", "message": str(exc)}
        raise
