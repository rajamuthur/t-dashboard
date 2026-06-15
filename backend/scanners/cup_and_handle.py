"""
Cup & Handle — bullish continuation.

A rounded bottom ('cup') where the left and right rims sit at a similar level,
followed by a short, shallow pullback ('handle') near the right rim, then a
breakout above the rim. Target = rim + cup depth (measured move).

Heuristic + vectorised; thresholds are tunable and will produce some false
positives (this is the loosest of the patterns). Needs deep daily history.
"""
import numpy as np
import pandas as pd
from .base import BaseScanner, ScanResult
from ._trend import LEAD, trend_aligned
from ._pivots import swing_pivots

RIM_TOL = 0.08            # left/right rims within this fraction of each other
MIN_DEPTH = 0.10          # cup depth as fraction of rim (>= shallow floor)
MAX_DEPTH = 0.50          # ...and <= this (a cup, not a crater)
HANDLE_FRAC = 0.18        # handle = last this fraction of the window
HANDLE_MAX_DEPTH = 0.5    # handle range <= this fraction of cup depth
HANDLE_MAX_RETRACE = 0.35 # handle low may retrace at most this fraction of the cup depth from the rim (a SHALLOW pullback)
BOTTOM_CENTER = (0.25, 0.75)  # rounded-bottom must sit in the middle


class CupHandleScanner(BaseScanner):
    analysis_type = "cup_handle"
    direction = "bullish"

    legend = [
        {"label": "Cup",    "color": "#a855f7", "text": "Rounded bottom (rim-bottom-rim)"},
        {"label": "Handle", "color": "#f59e0b", "text": "Shallow pullback near the rim"},
        {"label": "Entry",  "color": "#22c55e", "text": "Breakout above the rim"},
        {"label": "Stop",   "color": "#ef4444", "text": "Handle low"},
        {"label": "Target", "color": "#3b82f6", "text": "Rim + cup depth"},
    ]

    def window_for(self, timeframe: str) -> int:
        # Cup FORMS over >= min_months, plus trend context.
        return self.duration_candles(timeframe) + LEAD

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        n = self.duration_candles(timeframe)
        if len(df) < n:
            return ScanResult(matched=False)
        # Cup & handle is a continuation — require a prior up-trend into the cup.
        if not trend_aligned(df.iloc[:-n] if len(df) > n else df.iloc[:0], "bullish"):
            return ScanResult(matched=False)
        w = df.iloc[-n:]
        m = len(w)
        handle_len = max(3, int(m * HANDLE_FRAC))
        if m - handle_len < 15:
            return ScanResult(matched=False)

        cup = w.iloc[: m - handle_len]
        handle = w.iloc[m - handle_len:]

        ch = cup["high"].values.astype(float)
        cl = cup["low"].values.astype(float)
        edge = max(2, len(ch) // 5)
        left_rim = float(ch[:edge].max())
        right_rim = float(ch[-edge:].max())
        rim = max(left_rim, right_rim)
        bottom = float(cl.min())
        bottom_idx = int(cl.argmin())
        if rim <= 0 or bottom <= 0:
            return ScanResult(matched=False)

        depth = (rim - bottom) / rim
        if not (MIN_DEPTH <= depth <= MAX_DEPTH):
            return ScanResult(matched=False)
        if abs(left_rim - right_rim) / rim > RIM_TOL:
            return ScanResult(matched=False)
        frac = bottom_idx / max(1, len(cl) - 1)
        if not (BOTTOM_CENTER[0] <= frac <= BOTTOM_CENTER[1]):
            return ScanResult(matched=False)

        # Handle: a SHALLOW pullback near the right rim — not a deep drop toward
        # the cup bottom. Must stay below the rim (no breakout yet), tight range,
        # and retrace at most HANDLE_MAX_RETRACE of the cup depth from the rim.
        hh = float(handle["high"].max())
        hl = float(handle["low"].min())
        cup_depth_abs = rim - bottom
        if hh > rim * 1.02:
            return ScanResult(matched=False)
        if (hh - hl) > cup_depth_abs * HANDLE_MAX_DEPTH:
            return ScanResult(matched=False)
        if right_rim - hl > cup_depth_abs * HANDLE_MAX_RETRACE:  # too deep → not a handle
            return ScanResult(matched=False)
        if hl <= bottom:  # handle shouldn't dip below the cup bottom
            return ScanResult(matched=False)

        entry = round(rim, 2)
        stop = round(hl, 2)
        target = round(rim + cup_depth_abs, 2)
        if entry - stop <= 0:
            return ScanResult(matched=False)

        left_idx = int(ch[:edge].argmax())
        right_idx = len(ch) - edge + int(ch[-edge:].argmax())
        handle_lo_date = str(handle.index[int(handle["low"].values.argmin())])
        end_date = str(w.index[-1])

        # Trace the rounded cup through the REAL swing lows (a smooth U), not a
        # sharp 3-point V. Left rim -> intervening swing lows -> bottom -> right rim.
        _, cup_lows = swing_pivots(cup, k=3)
        u_pts = {left_idx: left_rim, right_idx: right_rim, bottom_idx: bottom}
        for idx, price in cup_lows:
            if left_idx < idx < right_idx:
                u_pts[idx] = price
        cup_points = [{"date": str(cup.index[i]), "price": round(p, 2)}
                      for i, p in sorted(u_pts.items())]

        details = {
            "direction": "bullish",
            "entry_mode": "breakout",
            "breakout_level": entry,
            "cup_depth_pct": round(depth * 100, 2),
            "entry_close": entry,
            "stop_loss": stop,
            "target": target,
            "shapes": [
                {"type": "polyline", "color": "#a855f7", "label": "Cup", "points": cup_points},
                {"type": "marker", "date": handle_lo_date, "price": hl, "color": "#f59e0b",
                 "text": "Handle", "position": "belowBar"},
                {"type": "hline", "price": entry, "color": "#22c55e", "label": "Entry (rim)"},
                {"type": "hline", "price": stop, "color": "#ef4444", "label": "Stop"},
                {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
            ],
        }
        return ScanResult(matched=True, details=details, candle_date=end_date)
