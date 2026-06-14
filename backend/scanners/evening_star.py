import pandas as pd
from .base import BaseScanner, ScanResult
from ._trend import LEAD, trend_aligned


class EveningStarScanner(BaseScanner):
    """Evening Star — 3-candle bearish reversal (mirror of Morning Star).

    C1: strong bullish (up) candle.
    C2: small-bodied 'star' at/above C1's close.
    C3: strong bearish candle closing back below the midpoint of C1's body.

    Gated to a down-trend (via the leading context window): we only take evening
    stars that are rallies/throwbacks inside a downtrend, not top-picking reversals.
    """
    analysis_type = "evening_star"
    window_size = 3 + LEAD          # 3-candle pattern + trend context
    direction = "bearish"

    marker_labels = ["C1", "C2", "C3"]
    marker_colors = ["#22c55e", "#f59e0b", "#ef4444"]
    legend = [
        {"label": "Entry",  "color": "#ef4444", "text": "C3 close (short entry)"},
        {"label": "Stop",   "color": "#22c55e", "text": "Highest high of the 3 candles"},
        {"label": "Target", "color": "#3b82f6", "text": "Entry - 1.5R"},
    ]

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        if len(df) < 3:
            return ScanResult(matched=False)
        # Trade only with the medium-term trend (sell rallies in a downtrend).
        if not trend_aligned(df.iloc[:-3], "bearish"):
            return ScanResult(matched=False)
        c1, c2, c3 = df.iloc[-3], df.iloc[-2], df.iloc[-1]

        def body(c): return abs(c["close"] - c["open"])
        def rng(c):  return max(c["high"] - c["low"], 1e-9)

        # C1: bullish with a substantial body.
        c1_ok = (c1["close"] > c1["open"]) and (body(c1) >= rng(c1) * 0.5)
        # C2: small body relative to C1, sitting at/above C1's close.
        c2_ok = (body(c2) <= body(c1) * 0.5) and (min(c2["open"], c2["close"]) >= c1["close"] * 0.995)
        # C3: bearish with a real body, breaking below the midpoint of C1's body.
        c1_mid = (c1["open"] + c1["close"]) / 2
        c3_ok = (
            (c3["close"] < c3["open"])
            and (body(c3) >= rng(c3) * 0.5)
            and (c3["close"] < c1_mid)
        )
        if not (c1_ok and c2_ok and c3_ok):
            return ScanResult(matched=False)

        entry = float(c3["close"])
        stop = float(max(c1["high"], c2["high"], c3["high"]))
        risk = stop - entry
        if risk <= 0:
            return ScanResult(matched=False)
        target = round(entry - 1.5 * risk, 2)
        entry, stop = round(entry, 2), round(stop, 2)

        d1, d2, d3 = (str(df.index[-3]), str(df.index[-2]), str(df.index[-1]))
        details = {
            "direction": "bearish",
            "entry_mode": "immediate",
            "entry_close": entry,
            "stop_loss": stop,
            "target": target,
            "shapes": [
                {"type": "marker", "date": d1, "price": float(c1["low"]),  "color": "#22c55e", "text": "C1", "position": "belowBar"},
                {"type": "marker", "date": d2, "price": float(c2["high"]), "color": "#f59e0b", "text": "C2", "position": "aboveBar"},
                {"type": "marker", "date": d3, "price": float(c3["low"]),  "color": "#ef4444", "text": "C3", "position": "belowBar"},
                {"type": "hline", "price": entry,  "color": "#ef4444", "label": "Entry"},
                {"type": "hline", "price": stop,   "color": "#22c55e", "label": "Stop"},
                {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
            ],
        }
        return ScanResult(matched=True, details=details, candle_date=d3)
