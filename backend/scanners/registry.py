from typing import Dict, Type
from .base import BaseScanner
from .three_candle import ThreeCandleReversalScanner
from .twin_doji_continuation import TwinDojiContinuationScanner
from .tight_range import TightRangeScanner
from .morning_star import MorningStarScanner
from .evening_star import EveningStarScanner
from .flag_pennant import FlagPennantScanner
from .cup_and_handle import CupHandleScanner
from .triangle import (
    AscendingTriangleScanner, DescendingTriangleScanner, SymmetricalTriangleScanner,
)
from .vcp import VCPScanner

_REGISTRY: Dict[str, Type[BaseScanner]] = {
    ThreeCandleReversalScanner.analysis_type:   ThreeCandleReversalScanner,
    TwinDojiContinuationScanner.analysis_type:  TwinDojiContinuationScanner,
    TightRangeScanner.analysis_type:            TightRangeScanner,
    MorningStarScanner.analysis_type:           MorningStarScanner,
    EveningStarScanner.analysis_type:           EveningStarScanner,
    FlagPennantScanner.analysis_type:           FlagPennantScanner,
    CupHandleScanner.analysis_type:             CupHandleScanner,
    AscendingTriangleScanner.analysis_type:     AscendingTriangleScanner,
    DescendingTriangleScanner.analysis_type:    DescendingTriangleScanner,
    SymmetricalTriangleScanner.analysis_type:   SymmetricalTriangleScanner,
    VCPScanner.analysis_type:                   VCPScanner,
}

# Daily-only scanners — shown under Daily Patterns, not Weekly/Monthly
DAILY_ANALYSIS_TYPES = {TightRangeScanner.analysis_type}

# Pattern scanners shown on the multi-timeframe Patterns page (Phase 1+).
PATTERN_ANALYSIS_TYPES = {
    MorningStarScanner.analysis_type,
    EveningStarScanner.analysis_type,
    FlagPennantScanner.analysis_type,
    CupHandleScanner.analysis_type,
    AscendingTriangleScanner.analysis_type,
    DescendingTriangleScanner.analysis_type,
    SymmetricalTriangleScanner.analysis_type,
    VCPScanner.analysis_type,
}


def get_scanner(analysis_type: str) -> BaseScanner:
    cls = _REGISTRY.get(analysis_type)
    if cls is None:
        raise ValueError(f"Unknown analysis_type: {analysis_type!r}")
    return cls()


def list_analysis_types() -> list[str]:
    return list(_REGISTRY.keys())
