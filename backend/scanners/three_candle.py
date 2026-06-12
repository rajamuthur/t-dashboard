import pandas as pd
from .base import BaseScanner, ScanResult


class ThreeCandleReversalScanner(BaseScanner):
    analysis_type = "3candle_reversal"

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        if len(df) < 3:
            return ScanResult(matched=False)

        c1, c2, c3 = df.iloc[-3], df.iloc[-2], df.iloc[-1]

        c1_range = c1["high"] - c1["low"]
        c1_body  = abs(c1["open"] - c1["close"])
        c1_ok = (c1["close"] < c1["open"]) and (c1_range > 0) and (c1_body > c1_range * 0.1)

        c2_range       = c2["high"] - c2["low"]
        c2_lower_wick  = c2["close"] - c2["low"]
        c2_ok = (c2["close"] < c2["open"]) and (c2_range > 0) and (c2_lower_wick <= c2_range * 0.15)

        c3_range = c3["high"] - c3["low"]
        c3_body  = abs(c3["open"] - c3["close"])
        c3_ok = (
            (c3["close"] >= c3["open"])
            and (c3["low"] >= c2["low"])
            and (c3_range > 0)
            and (c3_body <= c3_range * 0.3)
        )

        if c1_ok and c2_ok and c3_ok:
            return ScanResult(
                matched=True,
                details={
                    "stop_loss":   round(float(c2["low"]),   2),
                    "entry_close": round(float(c3["close"]), 2),
                },
                candle_date=str(df.index[-1]),
            )
        return ScanResult(matched=False)
