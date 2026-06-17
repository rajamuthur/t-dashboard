"""
5-minute intraday backtester.

Groups a symbol's 5m candles by trading day, runs the chosen strategy per day
(with the prior day as context), then simulates each entry one-position-at-a-time
to its stop/target (intrabar) or a forced square-off near the close. Applies a
round-trip cost (brokerage + slippage). Aggregates win% / expectancy / net P&L /
max-drawdown / trades-per-day and an equity curve.

Backtests on the underlying PRICE — valid for equity, stock/index futures, and
the index as the options *signal*. Options premium P&L is not modelled (no
historical option data); options is a live-only concern (Phase 3).
"""
import asyncio
import json
import sqlite3
from datetime import datetime, timezone

import pandas as pd

from .db import _get_db_path
from .strategies import get_strategy
from .universe_service import get_universe_stocks

SQUARE_OFF = "15:15"        # force-exit at/after this bar time
DEFAULT_COST_PCT = 0.10     # round-trip brokerage + slippage, in %
MIN_BARS = 20               # skip symbols with too little 5m history

_status: dict = {}


def get_backtest_status() -> dict:
    return dict(_status)


def _simulate_day(day: pd.DataFrame, entries, square_off: str, cost_pct: float) -> list[dict]:
    h = day["high"].to_numpy(float); l = day["low"].to_numpy(float); c = day["close"].to_numpy(float)
    times = [str(d)[11:16] for d in day.index]
    dates = [str(d)[:10] for d in day.index]
    n = len(day)
    trades: list[dict] = []
    open_until = -1                       # one position at a time
    for e in entries:
        if e.bar <= open_until or e.bar >= n - 1:
            continue
        exit_price = None; exit_bar = None; outcome = None
        for j in range(e.bar + 1, n):
            if times[j] >= square_off:
                exit_price, exit_bar, outcome = float(c[j]), j, "squareoff"; break
            if e.side == "long":
                if l[j] <= e.stop:   exit_price, exit_bar, outcome = e.stop, j, "stop"; break
                if h[j] >= e.target: exit_price, exit_bar, outcome = e.target, j, "target"; break
            else:
                if h[j] >= e.stop:   exit_price, exit_bar, outcome = e.stop, j, "stop"; break
                if l[j] <= e.target: exit_price, exit_bar, outcome = e.target, j, "target"; break
        if exit_price is None:
            exit_price, exit_bar, outcome = float(c[-1]), n - 1, "eod"
        gross = (exit_price - e.price) / e.price * 100 if e.side == "long" else (e.price - exit_price) / e.price * 100
        trades.append({
            "date": dates[e.bar], "side": e.side, "entry": e.price, "exit": round(float(exit_price), 2),
            "stop": e.stop, "target": e.target, "outcome": outcome,
            "pnl_pct": round(gross - cost_pct, 3), "reason": e.reason,
            "entry_time": times[e.bar], "exit_time": times[exit_bar],
        })
        open_until = exit_bar
    return trades


def _backtest_symbol(strategy, df: pd.DataFrame, square_off: str, cost_pct: float) -> list[dict]:
    df = df.copy()
    df["_day"] = [str(x)[:10] for x in df.index]
    trades: list[dict] = []
    prev = None
    for _, day in df.groupby("_day", sort=True):
        day = day.drop(columns=["_day"])
        if len(day) >= 5:
            trades += _simulate_day(day, strategy.generate(day, prev), square_off, cost_pct)
        prev = day
    return trades


def _agg(trades: list[dict]) -> dict:
    if not trades:
        return {"trades": 0, "wins": 0, "win_rate": 0.0, "expectancy": 0.0, "net_pct": 0.0,
                "avg_win": 0.0, "avg_loss": 0.0, "max_dd": 0.0, "days": 0}
    pnls = [t["pnl_pct"] for t in trades]
    wins = [p for p in pnls if p > 0]; losses = [p for p in pnls if p <= 0]
    net = sum(pnls)
    # max drawdown of the cumulative net-% curve
    cum = 0.0; peak = 0.0; max_dd = 0.0
    for p in pnls:
        cum += p; peak = max(peak, cum); max_dd = min(max_dd, cum - peak)
    days = len({t["date"] for t in trades})
    return {
        "trades": len(trades), "wins": len(wins),
        "win_rate": round(100 * len(wins) / len(trades), 1),
        "expectancy": round(net / len(trades), 3),
        "net_pct": round(net, 2),
        "avg_win": round(sum(wins) / len(wins), 3) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 3) if losses else 0.0,
        "max_dd": round(max_dd, 2),
        "days": days,
    }


def _run_sync(stocks, strategy_key, from_date, to_date, cost_pct, square_off, status) -> dict:
    db_path = _get_db_path()
    con = sqlite3.connect(db_path)
    strat = get_strategy(strategy_key)
    per_symbol: dict[str, dict] = {}
    all_trades: list[dict] = []
    total = len(stocks)
    for i, sym in enumerate(stocks):
        status["step"] = f"{sym} ({i + 1}/{total})"
        q = "SELECT date, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe='5m'"
        p: list = [sym]
        if from_date:
            q += " AND date>=?"; p.append(from_date)
        if to_date:
            q += " AND date<=?"; p.append(to_date + " 23:59:59")
        q += " ORDER BY date ASC"
        rows = con.execute(q, p).fetchall()
        if len(rows) < MIN_BARS:
            continue
        df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]).set_index("date")
        trades = _backtest_symbol(strat, df, square_off, cost_pct)
        if trades:
            for t in trades:
                t["symbol"] = sym
            per_symbol[sym] = _agg(trades)
            all_trades += trades
    con.close()

    # Overall + per-symbol ranking + equity curve (chronological).
    overall = _agg(all_trades)
    ranked = sorted(
        ({"symbol": s, **st} for s, st in per_symbol.items()),
        key=lambda r: r["net_pct"], reverse=True,
    )
    all_trades.sort(key=lambda t: (t["date"], t["entry_time"]))
    cum = 0.0; equity = []
    for t in all_trades:
        cum += t["pnl_pct"]; equity.append({"date": t["date"], "cum_pct": round(cum, 2)})
    return {
        "overall": overall,
        "per_symbol": ranked,
        "equity_curve": equity[-1500:],
        "trades": all_trades[-1000:],      # cap stored/returned trades
        "symbols_with_trades": len(per_symbol),
    }


async def run_backtest(strategy_key: str, universe: str = "fo", from_date: str | None = None,
                       to_date: str | None = None, cost_pct: float = DEFAULT_COST_PCT,
                       square_off: str = SQUARE_OFF) -> dict:
    global _status
    _status = {"status": "running", "step": "Resolving universe...", "strategy": strategy_key, "universe": universe}
    db_path = _get_db_path()
    try:
        stocks = await get_universe_stocks(universe)
        _status.update({"step": f"Backtesting {len(stocks)} symbols...", "total": len(stocks)})
        result = await asyncio.to_thread(_run_sync, stocks, strategy_key, from_date, to_date, cost_pct, square_off, _status)

        created_at = datetime.now(timezone.utc).isoformat()
        async with __import__("aiosqlite").connect(db_path) as db:
            await db.execute(
                """CREATE TABLE IF NOT EXISTS backtest_runs (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     strategy TEXT, universe TEXT, from_date TEXT, to_date TEXT,
                     cost_pct REAL, created_at TEXT, result TEXT)"""
            )
            cur = await db.execute(
                "INSERT INTO backtest_runs (strategy, universe, from_date, to_date, cost_pct, created_at, result)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                [strategy_key, universe, from_date, to_date, cost_pct, created_at, json.dumps(result)],
            )
            run_id = cur.lastrowid
            await db.commit()

        _status = {"status": "completed", "run_id": run_id, "strategy": strategy_key,
                   "universe": universe, "overall": result["overall"]}
        return _status
    except Exception as exc:
        _status = {"status": "failed", "message": str(exc)}
        raise
