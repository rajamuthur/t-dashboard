"""
Donchian channel breakout — long-only swing strategy.

  Entry (long): close breaks ABOVE the highest high of the prior N bars.
  Exit:         close breaks BELOW the lowest low of the prior N bars.

One position at a time, held across bars (positional swing — no intraday
square-off). N (lookback) defaults to 22 and is configurable. Works on
day / week / month candles.
"""
from typing import List, Optional

import pandas as pd

DEFAULT_LOOKBACK = 22
DEFAULT_COST_PCT = 0.15     # round-trip delivery brokerage + STT, in %


def donchian_backtest(df: pd.DataFrame, lookback: int = DEFAULT_LOOKBACK,
                      cost_pct: float = DEFAULT_COST_PCT) -> List[dict]:
    """Return the list of long trades for one symbol's ascending OHLC bars."""
    n = len(df)
    if n <= lookback + 1:
        return []
    h = df["high"].to_numpy(float); l = df["low"].to_numpy(float); c = df["close"].to_numpy(float)
    dates = [str(x)[:10] for x in df.index]
    trades: List[dict] = []
    pos: Optional[dict] = None

    def close_trade(exit_i: int, outcome: str):
        entry = pos["price"]
        exitp = float(c[exit_i])
        pnl = (exitp - entry) / entry * 100 - cost_pct
        trades.append({
            "entry_date": dates[pos["i"]], "entry": round(entry, 2),
            "exit_date": dates[exit_i], "exit": round(exitp, 2),
            "pnl_pct": round(pnl, 3), "bars_held": exit_i - pos["i"],
            "outcome": outcome,
        })

    for i in range(lookback, n):
        upper = float(h[i - lookback:i].max())   # highest high of the prior N bars
        lower = float(l[i - lookback:i].min())
        if pos is None:
            if c[i] > upper:
                pos = {"i": i, "price": float(c[i])}
        elif c[i] < lower:
            close_trade(i, "win" if (c[i] - pos["price"]) / pos["price"] * 100 - cost_pct > 0 else "loss")
            pos = None

    if pos is not None:                          # still holding at the end
        close_trade(n - 1, "open")
    return trades


def donchian_signal(df: pd.DataFrame, lookback: int = DEFAULT_LOOKBACK) -> Optional[dict]:
    """Fresh entry on the LATEST bar? Returns {entry, date, upper, stop} or None.

    Walks the position state so we only flag a genuine flat->long breakout that
    occurs on the most recent bar (not a bar that was already inside a position).
    """
    n = len(df)
    if n <= lookback + 1:
        return None
    h = df["high"].to_numpy(float); l = df["low"].to_numpy(float); c = df["close"].to_numpy(float)
    dates = [str(x)[:10] for x in df.index]
    in_pos = False
    entered_at = -1
    for i in range(lookback, n):
        upper = float(h[i - lookback:i].max())
        lower = float(l[i - lookback:i].min())
        if not in_pos:
            if c[i] > upper:
                in_pos = True; entered_at = i
        elif c[i] < lower:
            in_pos = False
    if in_pos and entered_at == n - 1:           # entered on the latest bar
        last = n - 1
        return {
            "entry": round(float(c[last]), 2),
            "date": dates[last],
            "upper": round(float(h[last - lookback:last].max()), 2),
            "stop": round(float(l[last - lookback:last].min()), 2),
        }
    return None
