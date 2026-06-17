"""Intraday strategy registry."""
from .base import Entry, IntradayStrategy
from .intraday import ORBStrategy, CPRStrategy, VWAPStrategy, TightBreakoutStrategy

_STRATEGIES = {
    s.key: s for s in (ORBStrategy(), CPRStrategy(), VWAPStrategy(), TightBreakoutStrategy())
}


def get_strategy(key: str) -> IntradayStrategy:
    s = _STRATEGIES.get(key)
    if s is None:
        raise ValueError(f"Unknown strategy: {key!r}")
    return s


def list_strategies() -> list[dict]:
    return [{"key": s.key, "label": s.label, "description": s.description} for s in _STRATEGIES.values()]


def strategy_keys() -> list[str]:
    return list(_STRATEGIES.keys())
