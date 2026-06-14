"""
Triangle continuation patterns — Ascending, Descending, Symmetrical.

Converging/flat trendlines fitted over a window, with a breakout-confirmed
entry (same outcome model as flags). Symmetrical triangles are bilateral, so
their bull/bear bias is taken from the prior trend leading into the triangle.

Heuristic + vectorised; slope/convergence/R^2/trend thresholds are tunable.
"""
import numpy as np
import pandas as pd
from .base import BaseScanner, ScanResult
from ._trend import LEAD, trend_aligned

TRIANGLE_LEN = 30          # candles forming the triangle
TREND_LEN = LEAD           # trend context before the triangle (>= ~1 month)
FLAT_TOL = 0.0006          # |norm slope| below this is "flat" (per-candle, /price) — tightened so the flat side is genuinely flat
TREND_TOL = 0.0015         # |norm slope| above this is clearly sloping (asc/desc)
CONV_TOL = 0.0006          # milder slope floor for symmetrical convergence
MIN_R2 = 0.20              # min fit quality on a sloping trendline (asc/desc)
COMPRESSION = 0.80         # late range must be <= this fraction of early range (narrowing)
TREND_MIN_PCT = 4.0        # prior move % to call a symmetrical bull/bear


def _fit(y: np.ndarray):
    x = np.arange(len(y))
    slope, intercept = np.polyfit(x, y, 1)
    fit = slope * x + intercept
    ss_res = float(np.sum((y - fit) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-9
    return float(slope), float(intercept), 1 - ss_res / ss_tot


def _detect(df: pd.DataFrame, want: str) -> ScanResult:
    if len(df) < TRIANGLE_LEN:
        return ScanResult(matched=False)
    tri = df.iloc[-TRIANGLE_LEN:]
    lead = df.iloc[:-TRIANGLE_LEN]          # trend context before the triangle
    n = len(tri)
    highs = tri["high"].values.astype(float)
    lows = tri["low"].values.astype(float)
    close = float(tri["close"].iloc[-1])
    if close <= 0:
        return ScanResult(matched=False)

    sh, ih, r2h = _fit(highs)
    sl, il, r2l = _fit(lows)
    nsh, nsl = sh / close, sl / close   # per-candle slope normalised by price

    # Range must be narrowing (the defining trait of a triangle).
    early = float(highs[:6].mean() - lows[:6].mean())
    late = float(highs[-6:].mean() - lows[-6:].mean())
    if early <= 0 or late >= early * COMPRESSION:
        return ScanResult(matched=False)

    bull = None
    if want == "ascending":
        if not (abs(nsh) < FLAT_TOL and nsl >= TREND_TOL and r2l >= MIN_R2):
            return ScanResult(matched=False)
        bull = True
    elif want == "descending":
        if not (abs(nsl) < FLAT_TOL and nsh <= -TREND_TOL and r2h >= MIN_R2):
            return ScanResult(matched=False)
        bull = False
    elif want == "symmetrical":
        # Converging lines (top down, bottom up). The narrowing (compression)
        # gate above is the primary signal, so slope floor is mild and R^2 isn't
        # required (fitting noisy swing highs/lows gives low R^2 on real triangles).
        if not (nsh <= -CONV_TOL and nsl >= CONV_TOL):
            return ScanResult(matched=False)
        trend = df.iloc[:-TRIANGLE_LEN]
        if len(trend) < 5:
            return ScanResult(matched=False)
        tc = trend["close"].values.astype(float)
        if tc[0] <= 0:
            return ScanResult(matched=False)
        move = (tc[-1] - tc[0]) / tc[0] * 100
        if move >= TREND_MIN_PCT:
            bull = True
        elif move <= -TREND_MIN_PCT:
            bull = False
        else:
            return ScanResult(matched=False)
    else:
        return ScanResult(matched=False)

    # Trade triangles only WITH the medium-term trend (breakout direction agrees).
    if bull is None or not trend_aligned(lead, "bullish" if bull else "bearish"):
        return ScanResult(matched=False)

    resistance_end = sh * (n - 1) + ih
    support_end = sl * (n - 1) + il
    base = ih - il                      # triangle height at its widest (start)
    if base <= 0:
        return ScanResult(matched=False)

    if bull:
        entry = resistance_end
        stop = support_end
        target = entry + base
    else:
        entry = support_end
        stop = resistance_end
        target = entry - base
    if abs(entry - stop) <= 0:
        return ScanResult(matched=False)
    entry, stop, target = round(entry, 2), round(stop, 2), round(target, 2)

    d0 = str(tri.index[0])
    d1 = str(tri.index[-1])
    details = {
        "direction": "bullish" if bull else "bearish",
        "subtype": want,
        "entry_mode": "breakout",
        "breakout_level": entry,
        "entry_close": entry,
        "stop_loss": stop,
        "target": target,
        "shapes": [
            {"type": "trendline", "color": "#f59e0b", "label": "Resistance",
             "points": [{"date": d0, "price": round(ih, 2)}, {"date": d1, "price": round(resistance_end, 2)}]},
            {"type": "trendline", "color": "#f59e0b", "label": "Support",
             "points": [{"date": d0, "price": round(il, 2)}, {"date": d1, "price": round(support_end, 2)}]},
            {"type": "hline", "price": entry,  "color": "#22c55e", "label": "Entry"},
            {"type": "hline", "price": stop,   "color": "#ef4444", "label": "Stop"},
            {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
        ],
    }
    return ScanResult(matched=True, details=details, candle_date=d1)


class _TriangleBase(BaseScanner):
    want = ""
    legend = [
        {"label": "Resistance", "color": "#f59e0b", "text": "Upper trendline"},
        {"label": "Support",    "color": "#f59e0b", "text": "Lower trendline"},
        {"label": "Entry",      "color": "#22c55e", "text": "Breakout level"},
        {"label": "Stop",       "color": "#ef4444", "text": "Opposite side"},
        {"label": "Target",     "color": "#3b82f6", "text": "Breakout +/- triangle height"},
    ]

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        return _detect(df, self.want)


class AscendingTriangleScanner(_TriangleBase):
    analysis_type = "ascending_triangle"
    window_size = TRIANGLE_LEN + LEAD        # triangle + trend context
    want = "ascending"


class DescendingTriangleScanner(_TriangleBase):
    analysis_type = "descending_triangle"
    window_size = TRIANGLE_LEN + LEAD        # triangle + trend context
    want = "descending"


class SymmetricalTriangleScanner(_TriangleBase):
    analysis_type = "symmetrical_triangle"
    window_size = TRIANGLE_LEN + LEAD        # triangle + prior-trend bias / context
    want = "symmetrical"
