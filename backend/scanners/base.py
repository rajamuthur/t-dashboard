from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional
import pandas as pd


@dataclass
class ScanResult:
    matched: bool
    details: Optional[dict] = field(default=None)
    candle_date: Optional[str] = field(default=None)


class BaseScanner(ABC):
    analysis_type: str = ""

    # Number of candles the pattern spans (including any optional leading context).
    window_size: int = 3

    # UI metadata consumed by the detail endpoint + OutcomeModal. Leave None to
    # fall back to the legacy 3-candle labels/colors baked into the frontend.
    marker_labels: Optional[List[str]] = None
    marker_colors: Optional[List[str]] = None
    # Offset into the returned candles[] at which markers begin. Use >0 when the
    # pattern window includes a leading advisory candle that shouldn't be marked.
    marker_offset: int = 0
    # Short human-readable legend entries: [{label, color, text}, ...]
    legend: Optional[List[dict]] = None

    @abstractmethod
    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        """Check the last `window_size` candles (live/current signal)."""
        raise NotImplementedError

    def scan_history(self, symbol: str, timeframe: str, df: pd.DataFrame) -> List[ScanResult]:
        """Slide a `window_size` window over df and return every historical match."""
        results: List[ScanResult] = []
        w = self.window_size
        for i in range(w - 1, len(df)):
            window = df.iloc[i - w + 1 : i + 1]
            result = self.run(symbol, timeframe, window)
            if result.matched:
                results.append(result)
        return results
