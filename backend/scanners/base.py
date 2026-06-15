from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional
import pandas as pd

# Approx. trading candles in one calendar month, per timeframe. Used to turn the
# user-configurable `min_months` into a candle count for each timeframe.
CANDLES_PER_MONTH = {
    "day": 21.0, "week": 4.33, "month": 1.0,
    "5m": 75.0, "15m": 25.0, "30m": 13.0, "1h": 7.0, "4h": 5.0,
}


@dataclass
class ScanResult:
    matched: bool
    details: Optional[dict] = field(default=None)
    candle_date: Optional[str] = field(default=None)


class BaseScanner(ABC):
    analysis_type: str = ""

    # Number of candles the pattern spans (including any optional leading context).
    # Legacy/fallback — timeframe-aware sizing is done via window_for().
    window_size: int = 3

    # Configurable minimum formation/context duration in months (set per-scan).
    # Base/trendline patterns (triangle, cup, VCP) FORM over >= this; short
    # patterns (flag, stars) require >= this much prior trend CONTEXT instead.
    min_months: float = 3.0

    # UI metadata consumed by the detail endpoint + OutcomeModal. Leave None to
    # fall back to the legacy 3-candle labels/colors baked into the frontend.
    marker_labels: Optional[List[str]] = None
    marker_colors: Optional[List[str]] = None
    # Offset into the returned candles[] at which markers begin. Use >0 when the
    # pattern window includes a leading advisory candle that shouldn't be marked.
    marker_offset: int = 0
    # Short human-readable legend entries: [{label, color, text}, ...]
    legend: Optional[List[dict]] = None

    def duration_candles(self, timeframe: str) -> int:
        """`min_months` converted to a candle count for this timeframe (>= 10)."""
        return max(10, round(self.min_months * CANDLES_PER_MONTH.get(timeframe, 21.0)))

    def window_for(self, timeframe: str) -> int:
        """Total candles the scanner needs for this timeframe (pattern + context).

        Default = legacy window_size; scanners with a duration-scaled formation or
        context override this. Used by the scan pipeline for the candle-count skip
        and the de-overlap gap, and by the detail endpoint for the focused chart.
        """
        return self.window_size

    @abstractmethod
    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        """Check the last `window_for(timeframe)` candles (live/current signal)."""
        raise NotImplementedError

    def scan_history(self, symbol: str, timeframe: str, df: pd.DataFrame) -> List[ScanResult]:
        """Slide a `window_for(timeframe)` window over df; return every match."""
        results: List[ScanResult] = []
        w = self.window_for(timeframe)
        for i in range(w - 1, len(df)):
            window = df.iloc[i - w + 1 : i + 1]
            result = self.run(symbol, timeframe, window)
            if result.matched:
                results.append(result)
        return results
