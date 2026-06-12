from typing import Dict, Type
from .base import BaseScanner
from .three_candle import ThreeCandleReversalScanner
from .twin_doji_continuation import TwinDojiContinuationScanner
from .tight_range import TightRangeScanner

_REGISTRY: Dict[str, Type[BaseScanner]] = {
    ThreeCandleReversalScanner.analysis_type:   ThreeCandleReversalScanner,
    TwinDojiContinuationScanner.analysis_type:  TwinDojiContinuationScanner,
    TightRangeScanner.analysis_type:            TightRangeScanner,
}

# Daily-only scanners — shown under Daily Patterns, not Weekly/Monthly
DAILY_ANALYSIS_TYPES = {TightRangeScanner.analysis_type}


def get_scanner(analysis_type: str) -> BaseScanner:
    cls = _REGISTRY.get(analysis_type)
    if cls is None:
        raise ValueError(f"Unknown analysis_type: {analysis_type!r}")
    return cls()


def list_analysis_types() -> list[str]:
    return list(_REGISTRY.keys())
