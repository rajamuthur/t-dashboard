import pandas as pd
from .base import BaseScanner, ScanResult


class MorningStarScanner(BaseScanner):
    """Morning Star — 3-candle bullish reversal.

    C1: strong bearish (down) candle.
    C2: small-bodied 'star' (indecision), gapping/closing below C1's body.
    C3: strong bullish candle that closes back above the midpoint of C1's body.
    """
    analysis_type = "morning_star"
    window_size = 3
    direction = "bullish"

    marker_labels = ["C1", "C2", "C3"]
    marker_colors = ["#ef4444", "#f59e0b", "#22c55e"]
    legend = [
        {"label": "Entry",  "color": "#22c55e", "text": "C3 close (long entry)"},
        {"label": "Stop",   "color": "#ef4444", "text": "Lowest low of the 3 candles"},
        {"label": "Target", "color": "#3b82f6", "text": "Entry + 1.5R"},
    ]

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        if len(df) < 3:
            return ScanResult(matched=False)
        c1, c2, c3 = df.iloc[-3], df.iloc[-2], df.iloc[-1]

        def body(c): return abs(c["close"] - c["open"])
        def rng(c):  return max(c["high"] - c["low"], 1e-9)

        # C1: bearish with a substantial body.
        c1_ok = (c1["close"] < c1["open"]) and (body(c1) >= rng(c1) * 0.5)
        # C2: small body relative to C1, sitting at/below C1's close (indecision/gap).
        c2_ok = (body(c2) <= body(c1) * 0.5) and (max(c2["open"], c2["close"]) <= c1["close"] * 1.005)
        # C3: bullish with a real body, reclaiming above the midpoint of C1's body.
        c1_mid = (c1["open"] + c1["close"]) / 2
        c3_ok = (
            (c3["close"] > c3["open"])
            and (body(c3) >= rng(c3) * 0.5)
            and (c3["close"] > c1_mid)
        )
        if not (c1_ok and c2_ok and c3_ok):
            return ScanResult(matched=False)

        entry = float(c3["close"])
        stop = float(min(c1["low"], c2["low"], c3["low"]))
        risk = entry - stop
        if risk <= 0:
            return ScanResult(matched=False)
        target = round(entry + 1.5 * risk, 2)
        entry, stop = round(entry, 2), round(stop, 2)

        d1, d2, d3 = (str(df.index[-3])[:10], str(df.index[-2])[:10], str(df.index[-1])[:10])
        details = {
            "direction": "bullish",
            "entry_mode": "immediate",
            "entry_close": entry,
            "stop_loss": stop,
            "target": target,
            "shapes": [
                {"type": "marker", "date": d1, "price": float(c1["high"]), "color": "#ef4444", "text": "C1", "position": "aboveBar"},
                {"type": "marker", "date": d2, "price": float(c2["low"]),  "color": "#f59e0b", "text": "C2", "position": "belowBar"},
                {"type": "marker", "date": d3, "price": float(c3["high"]), "color": "#22c55e", "text": "C3", "position": "aboveBar"},
                {"type": "hline", "price": entry,  "color": "#22c55e", "label": "Entry"},
                {"type": "hline", "price": stop,   "color": "#ef4444", "label": "Stop"},
                {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
            ],
        }
        return ScanResult(matched=True, details=details, candle_date=d3)
