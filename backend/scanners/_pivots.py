"""
Shared swing-pivot helpers for pattern line drawing.

Pattern trendlines must connect REAL swing pivots (the highs/lows price actually
turned at), not least-squares regression lines through every candle — regression
lines float through the middle of the action and look wrong. Every line-drawing
scanner anchors to these pivots so the drawn lines ride the actual tops/bottoms.

A fractal swing high at i is a high that is the maximum over [i-k, i+k]; a swing
low is the symmetric minimum. k controls how "significant" a turn must be.
"""
import numpy as np
import pandas as pd

# Trading sessions in ~1 month, per timeframe — used to require a real
# month-long formation (not a 5-6 session blip).
MONTH_SPAN = {"day": 21, "week": 4, "month": 1, "5m": 75, "15m": 25, "30m": 13, "1h": 7, "4h": 5}


def month_span(timeframe: str) -> int:
    return MONTH_SPAN.get(timeframe, 21)


def swing_pivots(df: pd.DataFrame, k: int = 3) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Return (swing_highs, swing_lows) as [(pos, price), ...] within df.

    pos is the integer offset into df. Edge candles (first/last k) can't be
    confirmed pivots.
    """
    h = df["high"].to_numpy(dtype=float)
    l = df["low"].to_numpy(dtype=float)
    n = len(df)
    highs: list[tuple[int, float]] = []
    lows: list[tuple[int, float]] = []
    for i in range(k, n - k):
        if h[i] >= h[i - k:i + k + 1].max():
            highs.append((i, float(h[i])))
        if l[i] <= l[i - k:i + k + 1].min():
            lows.append((i, float(l[i])))
    return highs, lows


def fit_line(pivots: list[tuple[int, float]]) -> tuple[float, float]:
    """Least-squares (slope, intercept) through pivot points (x = pos)."""
    if len(pivots) < 2:
        price = pivots[0][1] if pivots else 0.0
        return 0.0, float(price)
    xs = np.array([p[0] for p in pivots], dtype=float)
    ys = np.array([p[1] for p in pivots], dtype=float)
    slope, intercept = np.polyfit(xs, ys, 1)
    return float(slope), float(intercept)


def count_touches(pivots: list[tuple[int, float]], slope: float, intercept: float, tol: float) -> int:
    """How many pivots lie within `tol` (absolute price) of the line."""
    return sum(1 for idx, price in pivots if abs(price - (slope * idx + intercept)) <= tol)
