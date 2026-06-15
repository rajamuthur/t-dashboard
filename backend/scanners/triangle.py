"""
Triangle continuation patterns — Ascending, Descending, Symmetrical.

Detection uses regression-fitted converging/flat trendlines over a >= 1-month
window with an R^2 quality gate, range-compression, and trade-with-the-trend
filtering (this is what drives the win-rate). The drawn lines, however, are
ANCHORED to real swing pivots — the left end sits on an actual swing high/low and
extends to the breakout edge, with circles on every pivot the line rides — so the
lines visibly trace the tops/bottoms instead of floating through the candles.

Symmetrical triangles are bilateral, so their bull/bear bias is taken from the
trend leading into the triangle. Heuristic + vectorised; thresholds are tunable.
"""
import numpy as np
import pandas as pd

from .base import BaseScanner, ScanResult
from ._trend import LEAD, trend_aligned
from ._pivots import swing_pivots, fit_line

TRIANGLE_LEN = 30          # candles forming the triangle (~6 weeks daily, >= 1 month)
TREND_LEN = LEAD           # trend context before the triangle (>= ~1 month)
FLAT_TOL = 0.0006          # |norm slope| below this is "flat" (per-candle, /price)
TREND_TOL = 0.0015         # |norm slope| above this is clearly sloping (asc/desc)
CONV_TOL = 0.0006          # slope floor for symmetrical convergence
MIN_R2 = 0.20              # min fit quality on a sloping trendline (asc/desc)
COMPRESSION = 0.80         # late range must be <= this fraction of early range (narrowing)
TREND_MIN_PCT = 4.0        # prior move % to call a symmetrical bull/bear
PIVOT_K = 3                # fractal swing strength for drawn lines + consistency gate
PIVOT_FLAT = 0.0016        # |norm pivot-slope| below this is "flat" (2-pt pivot slopes are noisier)
PIVOT_SLOPE = 0.0004       # |norm pivot-slope| above this is "clearly sloping"


def _fit(y: np.ndarray):
    x = np.arange(len(y))
    slope, intercept = np.polyfit(x, y, 1)
    fit = slope * x + intercept
    ss_res = float(np.sum((y - fit) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-9
    return float(slope), float(intercept), 1 - ss_res / ss_tot


def _detect(df: pd.DataFrame, want: str, timeframe: str) -> ScanResult:
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

    # --- Screen: range narrowing + shape (regression-based, drives win-rate) ---
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
        if not (nsh <= -CONV_TOL and nsl >= CONV_TOL):
            return ScanResult(matched=False)
        tc = lead["close"].values.astype(float)
        if len(tc) < 5 or tc[0] <= 0:
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

    if bull is None or not trend_aligned(lead, "bullish" if bull else "bearish"):
        return ScanResult(matched=False)

    # Levels from the regression fit (this is what drives the win-rate — pivot
    # lines as levels test far worse).
    resistance_end = sh * (n - 1) + ih
    support_end = sl * (n - 1) + il
    base = ih - il                       # triangle height at its widest (start)
    if base <= 0:
        return ScanResult(matched=False)
    if bull:
        entry, stop, target = resistance_end, support_end, resistance_end + base
    else:
        entry, stop, target = support_end, resistance_end, support_end - base
    if abs(entry - stop) <= 0:
        return ScanResult(matched=False)
    entry, stop, target = round(entry, 2), round(stop, 2), round(target, 2)

    # --- Pivot consistency gate + drawing. Fit trendlines through the REAL swing
    # highs/lows; require their direction to agree with the pattern (rejects
    # regression false-positives whose real pivots contradict it, e.g. SCHNEIDER's
    # rising highs called a "symmetrical"). Draw THESE pivot lines so they ride
    # the actual tops/bottoms — while entry/stop/target stay on the regression
    # levels above (which is what tests well).
    swing_h, swing_l = swing_pivots(tri, PIVOT_K)
    if len(swing_h) < 2 or len(swing_l) < 2:
        return ScanResult(matched=False)
    rs, ri = fit_line(swing_h)
    ps, pi = fit_line(swing_l)
    nrs, nps = rs / close, ps / close
    if want == "ascending":
        ok = abs(nrs) < PIVOT_FLAT and nps > PIVOT_SLOPE
    elif want == "descending":
        ok = nrs < -PIVOT_SLOPE and abs(nps) < PIVOT_FLAT
    else:  # symmetrical
        ok = nrs < -PIVOT_SLOPE and nps > PIVOT_SLOPE
    if not ok:
        return ScanResult(matched=False)

    rh0, sl0 = swing_h[0][0], swing_l[0][0]
    res_pts = [{"date": str(tri.index[rh0]), "price": round(rs * rh0 + ri, 2)},
               {"date": str(tri.index[n - 1]), "price": round(rs * (n - 1) + ri, 2)}]
    sup_pts = [{"date": str(tri.index[sl0]), "price": round(ps * sl0 + pi, 2)},
               {"date": str(tri.index[n - 1]), "price": round(ps * (n - 1) + pi, 2)}]
    touch_markers = [{"type": "marker", "date": str(tri.index[i]), "price": p, "color": "#f59e0b",
                      "position": "aboveBar", "text": ""} for i, p in swing_h]
    touch_markers += [{"type": "marker", "date": str(tri.index[i]), "price": p, "color": "#f59e0b",
                       "position": "belowBar", "text": ""} for i, p in swing_l]
    n_th, n_tl = len(swing_h), len(swing_l)

    d1 = str(tri.index[-1])
    details = {
        "direction": "bullish" if bull else "bearish",
        "subtype": want,
        "entry_mode": "breakout",
        "breakout_level": entry,
        "entry_close": entry,
        "stop_loss": stop,
        "target": target,
        "touches": f"{n_th}H/{n_tl}L",
        "span_candles": TRIANGLE_LEN,
        "shapes": [
            {"type": "trendline", "color": "#f59e0b", "label": "Resistance", "points": res_pts},
            {"type": "trendline", "color": "#f59e0b", "label": "Support", "points": sup_pts},
            *touch_markers,
            {"type": "hline", "price": entry,  "color": "#22c55e", "label": "Entry"},
            {"type": "hline", "price": stop,   "color": "#ef4444", "label": "Stop"},
            {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
        ],
    }
    return ScanResult(matched=True, details=details, candle_date=d1)


class _TriangleBase(BaseScanner):
    want = ""
    legend = [
        {"label": "Resistance", "color": "#f59e0b", "text": "Upper trendline (anchored on pivots)"},
        {"label": "Support",    "color": "#f59e0b", "text": "Lower trendline (anchored on pivots)"},
        {"label": "Entry",      "color": "#22c55e", "text": "Breakout level"},
        {"label": "Stop",       "color": "#ef4444", "text": "Opposite side"},
        {"label": "Target",     "color": "#3b82f6", "text": "Breakout +/- triangle height"},
    ]

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        return _detect(df, self.want, timeframe)


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
