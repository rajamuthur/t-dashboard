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

CUP_LEN = 80              # cup + handle (the drawn pattern)
RIM_TOL = 0.08            # left/right rims within this fraction of each other
MIN_DEPTH = 0.10          # cup depth as fraction of rim (>= shallow floor)
MAX_DEPTH = 0.50          # ...and <= this (a cup, not a crater)
HANDLE_FRAC = 0.18        # handle = last this fraction of the window
HANDLE_MAX_DEPTH = 0.5    # handle range <= this fraction of cup depth
BOTTOM_CENTER = (0.25, 0.75)  # rounded-bottom must sit in the middle


class CupHandleScanner(BaseScanner):
    analysis_type = "cup_handle"
    window_size = CUP_LEN + LEAD   # cup (~4 months) + trend context
    direction = "bullish"

    legend = [
        {"label": "Cup",    "color": "#a855f7", "text": "Rounded bottom (rim-bottom-rim)"},
        {"label": "Handle", "color": "#f59e0b", "text": "Shallow pullback near the rim"},
        {"label": "Entry",  "color": "#22c55e", "text": "Breakout above the rim"},
        {"label": "Stop",   "color": "#ef4444", "text": "Handle low"},
        {"label": "Target", "color": "#3b82f6", "text": "Rim + cup depth"},
    ]

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        n = CUP_LEN
        if len(df) < 40:
            return ScanResult(matched=False)
        # Cup & handle is a continuation — require a prior up-trend into the cup.
        if not trend_aligned(df.iloc[:-n] if len(df) > n else df.iloc[:0], "bullish"):
            return ScanResult(matched=False)
        w = df.iloc[-n:] if len(df) >= n else df
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

        # Handle: below the rim (not yet broken out) and shallow vs the cup.
        hh = float(handle["high"].max())
        hl = float(handle["low"].min())
        cup_depth_abs = rim - bottom
        if hh > rim * 1.02:
            return ScanResult(matched=False)
        if (hh - hl) > cup_depth_abs * HANDLE_MAX_DEPTH:
            return ScanResult(matched=False)
        if hl <= bottom:  # handle shouldn't dip below the cup bottom
            return ScanResult(matched=False)

        entry = round(rim, 2)
        stop = round(hl, 2)
        target = round(rim + cup_depth_abs, 2)
        if entry - stop <= 0:
            return ScanResult(matched=False)

        left_date = str(cup.index[int(ch[:edge].argmax())])
        bottom_date = str(cup.index[bottom_idx])
        right_date = str(cup.index[len(ch) - edge + int(ch[-edge:].argmax())])
        handle_lo_date = str(handle.index[int(handle["low"].values.argmin())])
        end_date = str(w.index[-1])

        details = {
            "direction": "bullish",
            "entry_mode": "breakout",
            "breakout_level": entry,
            "cup_depth_pct": round(depth * 100, 2),
            "entry_close": entry,
            "stop_loss": stop,
            "target": target,
            "shapes": [
                {"type": "polyline", "color": "#a855f7", "label": "Cup",
                 "points": [{"date": left_date, "price": round(left_rim, 2)},
                            {"date": bottom_date, "price": round(bottom, 2)},
                            {"date": right_date, "price": round(right_rim, 2)}]},
                {"type": "marker", "date": handle_lo_date, "price": hl, "color": "#f59e0b",
                 "text": "Handle", "position": "belowBar"},
                {"type": "hline", "price": entry, "color": "#22c55e", "label": "Entry (rim)"},
                {"type": "hline", "price": stop, "color": "#ef4444", "label": "Stop"},
                {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
            ],
        }
        return ScanResult(matched=True, details=details, candle_date=end_date)
