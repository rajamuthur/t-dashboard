"""
EMA 50 / EMA 200 cross scanner over a stock universe (daily/weekly candles).

Bull : EMA50 crosses ABOVE EMA200 (golden cross) within the recency window AND
       the stock trades above EMA200.
Bear : EMA50 crosses BELOW EMA200 (death cross) within the window AND the stock
       trades below EMA200.
Coiling flag ("added advantage"): over the last ~1-2 weeks both EMAs stayed
within `near_pct` of each other AND price hugged EMA200 within `near_pct` — the
tight, high-quality setups. Coiling matches sort to the top.

Reads the synced `candles` table (no network), same as the swing scanner.
"""
import asyncio
import sqlite3
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .db import _get_db_path
from .universe_service import get_universe_stocks

_MIN_BARS = 205                      # need a mature EMA200
_EMA_FAST, _EMA_SLOW = 50, 200

_status: dict = {}
_result: dict = {"rows": [], "at": None, "params": {}, "counts": {}}


def get_status() -> dict:
    return dict(_status)


def get_result() -> dict:
    return dict(_result)


def _load(con, sym: str, timeframe: str) -> pd.DataFrame:
    rows = con.execute(
        "SELECT date, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=? ORDER BY date ASC",
        [sym, timeframe],
    ).fetchall()
    return pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]).set_index("date")


def _emas(close: pd.Series) -> tuple[pd.Series, pd.Series]:
    return (close.ewm(span=_EMA_FAST, adjust=False).mean(),
            close.ewm(span=_EMA_SLOW, adjust=False).mean())


def _last_cross(diff: np.ndarray) -> tuple[int | None, str | None]:
    """Index + direction of the most recent EMA50/EMA200 cross (scan backwards)."""
    for i in range(len(diff) - 1, 0, -1):
        if diff[i] > 0 and diff[i - 1] <= 0:
            return i, "BULL"
        if diff[i] < 0 and diff[i - 1] >= 0:
            return i, "BEAR"
    return None, None


def _scan_sym(df: pd.DataFrame, cross_window: int, near_pct: float, near_bars: int) -> dict | None:
    if len(df) < _MIN_BARS:
        return None
    close = df["close"].astype(float)
    ema50, ema200 = _emas(close)
    diff = (ema50 - ema200).to_numpy()
    n = len(diff)
    idx, direction = _last_cross(diff)
    if idx is None:
        return None
    days_since = (n - 1) - idx
    if days_since > cross_window:
        return None

    last_close = float(close.iloc[-1]); last50 = float(ema50.iloc[-1]); last200 = float(ema200.iloc[-1])
    if last200 <= 0:
        return None
    if direction == "BULL" and not last_close > last200:
        return None
    if direction == "BEAR" and not last_close < last200:
        return None

    # Coiling: EMAs close together AND price near EMA200 across the last near_bars.
    w = min(near_bars, n)
    e50 = ema50.to_numpy()[-w:]; e200 = ema200.to_numpy()[-w:]; c = close.to_numpy()[-w:]
    gap = np.abs(e50 - e200) / e200 * 100
    dev = np.abs(c - e200) / e200 * 100
    within = (gap <= near_pct) & (dev <= near_pct)
    coiling = bool(within.all())
    coiled_bars = int(within.sum())

    dates = [str(x) for x in df.index]
    return {
        "signal": direction,
        "cross_date": dates[idx][:10],
        "days_since": days_since,
        "close": round(last_close, 2),
        "ema50": round(last50, 2),
        "ema200": round(last200, 2),
        "gap_pct": round(abs(last50 - last200) / last200 * 100, 2),
        "price_vs_ema200_pct": round((last_close - last200) / last200 * 100, 2),
        "coiling": coiling,
        "coiled_bars": coiled_bars,
    }


def _scan_sync(stocks, timeframe, cross_window, near_pct, near_bars, status) -> dict:
    con = sqlite3.connect(_get_db_path())
    matches: list[dict] = []
    total = len(stocks)
    for i, sym in enumerate(stocks):
        name = sym.replace("NSE:", "").replace("-EQ", "")
        status["current"] = name; status["done"] = i; status["pending"] = total - i
        status["total"] = total; status["step"] = f"{name} ({i + 1}/{total})"
        try:
            m = _scan_sym(_load(con, sym, timeframe), cross_window, near_pct, near_bars)
        except Exception:
            m = None
        if m:
            m["symbol"] = sym
            matches.append(m)
    con.close()
    # Coiling first, then most recent cross.
    matches.sort(key=lambda r: (not r["coiling"], r["days_since"]))
    return {
        "matches": matches,
        "bull": sum(1 for m in matches if m["signal"] == "BULL"),
        "bear": sum(1 for m in matches if m["signal"] == "BEAR"),
        "coiling": sum(1 for m in matches if m["coiling"]),
        "scanned": total,
    }


async def run_scan(universe: str = "nifty50", timeframe: str = "day",
                   cross_window: int = 10, near_pct: float = 2.0, near_bars: int = 10) -> dict:
    global _status, _result
    _status = {"status": "running", "step": "Resolving universe…", "universe": universe, "timeframe": timeframe}
    try:
        stocks = await get_universe_stocks(universe)
        _status.update({"step": f"Scanning {len(stocks)} stocks…", "total": len(stocks)})
        res = await asyncio.to_thread(_scan_sync, stocks, timeframe, cross_window, near_pct, near_bars, _status)
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _result = {
            "rows": res["matches"], "at": at,
            "params": {"universe": universe, "timeframe": timeframe, "cross_window": cross_window,
                       "near_pct": near_pct, "near_bars": near_bars},
            "counts": {"bull": res["bull"], "bear": res["bear"], "coiling": res["coiling"], "scanned": res["scanned"]},
        }
        _status = {"status": "completed", "at": at, "universe": universe, "timeframe": timeframe,
                   "bull": res["bull"], "bear": res["bear"], "coiling": res["coiling"],
                   "scanned": res["scanned"], "matches": len(res["matches"])}
        return _status
    except Exception as exc:
        _status = {"status": "failed", "message": str(exc)}
        raise


def _chart_sync(symbol: str, timeframe: str) -> dict:
    con = sqlite3.connect(_get_db_path())
    df = _load(con, symbol, timeframe)
    con.close()
    if df.empty:
        return {"candles": [], "shapes": [], "focus_date": None}
    close = df["close"].astype(float)
    ema50, ema200 = _emas(close)
    dates = [str(x) for x in df.index]
    candles = [{"date": str(i), "open": r.open, "high": r.high, "low": r.low, "close": r.close, "volume": r.volume}
               for i, r in df.iterrows()]
    # Plot each EMA only where it's mature (skip the warm-up).
    e50 = [{"date": dates[k], "price": round(float(ema50.iloc[k]), 2)} for k in range(min(_EMA_FAST, len(df)), len(df))]
    e200 = [{"date": dates[k], "price": round(float(ema200.iloc[k]), 2)} for k in range(min(_EMA_SLOW, len(df)), len(df))]
    shapes: list[dict] = [
        {"type": "polyline", "color": "#f59e0b", "label": "EMA 50", "points": e50},
        {"type": "polyline", "color": "#ef4444", "label": "EMA 200", "points": e200},
    ]
    idx, direction = _last_cross((ema50 - ema200).to_numpy())
    focus = dates[-1][:10]
    if idx is not None:
        focus = dates[idx][:10]
        shapes.append({
            "type": "marker", "date": dates[idx], "price": float(close.iloc[idx]),
            "color": "#22c55e" if direction == "BULL" else "#ef4444",
            "position": "belowBar" if direction == "BULL" else "aboveBar",
            "text": "Golden" if direction == "BULL" else "Death",
        })
    return {"candles": candles, "shapes": shapes, "focus_date": focus}


async def chart_data(symbol: str, timeframe: str = "day") -> dict:
    return await asyncio.to_thread(_chart_sync, symbol, timeframe)
