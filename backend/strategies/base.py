"""
Intraday strategy framework (5-minute bars).

A strategy looks at ONE trading day's 5m bars (plus the prior day for context
like CPR/pivots) and emits ENTRY signals. The backtester owns exits — it walks
each entry forward to its stop/target or force-squares-off near the close, takes
one position at a time, and applies costs. This keeps strategies small and
declarative; all the fill/risk machinery lives in one place (intraday_backtest).

Phase 1 backtests on the underlying PRICE (works for equity / stock & index
futures, and for the index as the options *signal*). Options premium P&L is not
modelled here — there's no historical option-chain data — so options execution
is a live-only concern (Phase 3).
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional

import pandas as pd


@dataclass
class Entry:
    bar: int                 # integer index within the day's bars where it triggers
    side: str                # "long" | "short"
    price: float             # entry (the trigger bar's close)
    stop: float
    target: float
    reason: str = ""
    meta: dict = field(default_factory=dict)


class IntradayStrategy(ABC):
    key: str = ""
    label: str = ""
    description: str = ""

    # Don't trigger new entries at/after this bar time (let positions square off,
    # don't open fresh risk near the close).
    no_new_after: str = "14:45"

    @abstractmethod
    def generate(self, day: pd.DataFrame, prev_day: Optional[pd.DataFrame]) -> List[Entry]:
        """Entries for one day's ascending 5m bars (index = 'YYYY-MM-DD HH:MM:SS')."""
        raise NotImplementedError

    # ---- helpers shared by strategies ----
    @staticmethod
    def _bar_time(day: pd.DataFrame, i: int) -> str:
        ts = str(day.index[i])
        return ts[11:16] if len(ts) >= 16 else ""

    def _too_late(self, day: pd.DataFrame, i: int) -> bool:
        t = self._bar_time(day, i)
        return bool(t) and t >= self.no_new_after
