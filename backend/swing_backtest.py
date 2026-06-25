"""
Swing backtester for the Donchian breakout strategy over a stock universe
(default NIFTY 500 ≈ the >5000cr names) on day / week / month candles.

Backtest: per-symbol trades aggregated into win% / expectancy / net% / max-DD /
avg bars-held + an equity curve. Current: stocks giving a fresh entry on the
latest bar. Runs persist to a `swing_runs` table.
"""
import asyncio
import json
import sqlite3
from datetime import datetime, timezone

import pandas as pd

from .db import _get_db_path
from .strategies.donchian import donchian_backtest, donchian_signal, DEFAULT_COST_PCT
from .universe_service import get_universe_stocks

_status: dict = {}


def get_swing_status() -> dict:
    return dict(_status)


def _agg(trades: list[dict]) -> dict:
    closed = [t for t in trades if t["outcome"] != "open"]
    if not closed:
        return {"trades": len(trades), "wins": 0, "win_rate": 0.0, "expectancy": 0.0,
                "net_pct": 0.0, "avg_win": 0.0, "avg_loss": 0.0, "max_dd": 0.0,
                "avg_bars": 0.0, "open": len(trades)}
    pnls = [t["pnl_pct"] for t in closed]
    wins = [p for p in pnls if p > 0]; losses = [p for p in pnls if p <= 0]
    cum = peak = mdd = 0.0
    for p in pnls:
        cum += p; peak = max(peak, cum); mdd = min(mdd, cum - peak)
    return {
        "trades": len(closed), "wins": len(wins),
        "win_rate": round(100 * len(wins) / len(closed), 1),
        "expectancy": round(sum(pnls) / len(closed), 3),
        "net_pct": round(sum(pnls), 2),
        "avg_win": round(sum(wins) / len(wins), 3) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 3) if losses else 0.0,
        "max_dd": round(mdd, 2),
        "avg_bars": round(sum(t["bars_held"] for t in closed) / len(closed), 1),
        "open": sum(1 for t in trades if t["outcome"] == "open"),
    }


def _load(con, sym: str, timeframe: str) -> pd.DataFrame:
    rows = con.execute(
        "SELECT date, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=? ORDER BY date ASC",
        [sym, timeframe],
    ).fetchall()
    return pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]).set_index("date")


def _run_sync(stocks, timeframe, lookback, cost_pct, status) -> dict:
    con = sqlite3.connect(_get_db_path())
    per_symbol: dict[str, dict] = {}
    all_trades: list[dict] = []
    total = len(stocks)
    for i, sym in enumerate(stocks):
        status["step"] = f"{sym} ({i + 1}/{total})"
        df = _load(con, sym, timeframe)
        if len(df) <= lookback + 2:
            continue
        trades = donchian_backtest(df, lookback, cost_pct)
        if trades:
            for t in trades:
                t["symbol"] = sym
            per_symbol[sym] = _agg(trades)
            all_trades += trades
    con.close()

    overall = _agg(all_trades)
    ranked = sorted(({"symbol": s, **st} for s, st in per_symbol.items()),
                    key=lambda r: r["net_pct"], reverse=True)
    closed = sorted([t for t in all_trades if t["outcome"] != "open"], key=lambda t: t["exit_date"])
    cum = 0.0; equity = []
    for t in closed:
        cum += t["pnl_pct"]; equity.append({"date": t["exit_date"], "cum_pct": round(cum, 2)})
    all_trades.sort(key=lambda t: t["entry_date"], reverse=True)
    return {
        "overall": overall,
        "per_symbol": ranked,
        "equity_curve": equity[-1500:],
        "trades": all_trades[:1000],
        "symbols_with_trades": len(per_symbol),
    }


async def run_swing_backtest(timeframe: str = "day", lookback: int = 22,
                             universe: str = "nifty500", cost_pct: float = DEFAULT_COST_PCT) -> dict:
    global _status
    _status = {"status": "running", "step": "Resolving universe...", "timeframe": timeframe,
               "lookback": lookback, "universe": universe}
    db_path = _get_db_path()
    try:
        stocks = await get_universe_stocks(universe)
        _status.update({"step": f"Backtesting {len(stocks)} symbols...", "total": len(stocks)})
        result = await asyncio.to_thread(_run_sync, stocks, timeframe, lookback, cost_pct, _status)

        created_at = datetime.now(timezone.utc).isoformat()
        async with __import__("aiosqlite").connect(db_path) as db:
            await db.execute(
                """CREATE TABLE IF NOT EXISTS swing_runs (
                     id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT, timeframe TEXT,
                     lookback INTEGER, universe TEXT, created_at TEXT, result TEXT)"""
            )
            cur = await db.execute(
                "INSERT INTO swing_runs (strategy, timeframe, lookback, universe, created_at, result)"
                " VALUES ('donchian', ?, ?, ?, ?, ?)",
                [timeframe, lookback, universe, created_at, json.dumps(result)],
            )
            run_id = cur.lastrowid
            await db.commit()

        _status = {"status": "completed", "run_id": run_id, "timeframe": timeframe,
                   "lookback": lookback, "universe": universe, "overall": result["overall"]}
        return _status
    except Exception as exc:
        _status = {"status": "failed", "message": str(exc)}
        raise


def _current_sync(stocks, timeframe, lookback) -> list[dict]:
    con = sqlite3.connect(_get_db_path())
    out = []
    for sym in stocks:
        df = _load(con, sym, timeframe)
        sig = donchian_signal(df, lookback)
        if sig:
            out.append({"symbol": sym, **sig})
    con.close()
    out.sort(key=lambda r: r["symbol"])
    return out


async def current_signals(timeframe: str = "day", lookback: int = 22, universe: str = "nifty500") -> list[dict]:
    stocks = await get_universe_stocks(universe)
    return await asyncio.to_thread(_current_sync, stocks, timeframe, lookback)
