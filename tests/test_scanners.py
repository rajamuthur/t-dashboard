import pandas as pd
import pytest
from backend.scanners.three_candle import ThreeCandleReversalScanner
from backend.scanners.registry import get_scanner, list_analysis_types

def _df(rows):
    df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])
    return df.set_index("date")

_MATCH = [
    ("2026-01-01", 100, 105, 80, 88, 1000),
    ("2026-01-08",  88,  90, 70, 73, 1000),
    ("2026-01-15",  73,  79, 72, 75, 1000),
]

def test_matches_valid_pattern():
    r = ThreeCandleReversalScanner().run("SYM", "week", _df(_MATCH))
    assert r.matched is True
    assert r.details["stop_loss"] == 70.0
    assert r.details["entry_close"] == 75.0

def test_no_match_c1_is_green():
    rows = list(_MATCH)
    rows[0] = ("2026-01-01", 80, 105, 78, 100, 1000)
    assert ThreeCandleReversalScanner().run("SYM", "week", _df(rows)).matched is False

def test_no_match_c2_lower_wick_too_large():
    rows = list(_MATCH)
    rows[1] = ("2026-01-08", 88, 90, 70, 80, 1000)
    assert ThreeCandleReversalScanner().run("SYM", "week", _df(rows)).matched is False

def test_no_match_c3_low_below_c2():
    rows = list(_MATCH)
    rows[2] = ("2026-01-15", 73, 79, 65, 75, 1000)
    assert ThreeCandleReversalScanner().run("SYM", "week", _df(rows)).matched is False

def test_no_match_c3_body_too_large():
    rows = list(_MATCH)
    rows[2] = ("2026-01-15", 73, 80, 72, 79, 1000)
    assert ThreeCandleReversalScanner().run("SYM", "week", _df(rows)).matched is False

def test_no_match_too_few_candles():
    assert ThreeCandleReversalScanner().run("SYM", "week", _df(_MATCH[:2])).matched is False

def test_registry_returns_scanner():
    scanner = get_scanner("3candle_reversal")
    assert isinstance(scanner, ThreeCandleReversalScanner)

def test_list_analysis_types():
    assert "3candle_reversal" in list_analysis_types()
