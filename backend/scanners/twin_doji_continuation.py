"""
twin_doji_continuation — 4-candle bullish continuation pattern.

Structure
---------
    C1 (optional / advisory) — leading context candle
    C2 — big green candle with small wicks on both sides
    C3 — doji with small wicks on both sides
    C4 — doji with small wicks on both sides (signal candle)

Hypothesis: after strong green momentum (C2) the market compresses across
two dojis (C3, C4). If C4 closes as a small-wick doji, C5 is expected to
resume the bullish expansion (i.e. print like C2).

Entry / stop
------------
    entry_close = C4.close
    stop_loss   = min(C3.low, C4.low)
    signal date = C4 date

All thresholds are loaded from config (`analysis_params.twin_doji_continuation`)
with sensible defaults as fallback — nothing hardcoded in the pattern logic.
"""
import json
import sqlite3
from typing import Optional

import pandas as pd

from .base import BaseScanner, ScanResult


class TwinDojiContinuationScanner(BaseScanner):
    analysis_type = "twin_doji_continuation"
    window_size = 4

    # Markers land on C2/C3/C4 (offset=1 skips the optional advisory C1).
    marker_offset = 1
    marker_labels = ["C2", "C3", "C4"]
    marker_colors = ["#22c55e", "#eab308", "#eab308"]
    legend = [
        {"label": "C2", "color": "#22c55e", "text": "Big green (body ≥ 60% of range)"},
        {"label": "C3", "color": "#eab308", "text": "Doji (small body)"},
        {"label": "C4", "color": "#eab308", "text": "Doji (signal, small body)"},
    ]

    # Thresholds expressed in percent (0-100) of the candle range.
    # - A "big green" is green + body >= c2_min_body_pct of range (wicks free).
    # - A doji is a candle whose body is small relative to its range (wicks free).
    DEFAULT_PARAMS = {
        "c1_require_green":        False,
        "c2_min_body_pct":         60,
        "c3_max_body_pct":         15,
        "c4_max_body_pct":         15,
    }

    def __init__(self, params: Optional[dict] = None):
        loaded = params if params is not None else self._load_params_from_config()
        self.params = {**self.DEFAULT_PARAMS, **(loaded or {})}

    def _load_params_from_config(self) -> dict:
        """Sync read of `analysis_params` from the config table.

        Returns an empty dict on any error so the caller falls back to
        DEFAULT_PARAMS. Runs once per scanner instantiation (not per candle).
        """
        try:
            from ..db import _get_db_path
            con = sqlite3.connect(_get_db_path())
            try:
                cur = con.execute(
                    "SELECT value FROM config WHERE key='analysis_params'"
                )
                row = cur.fetchone()
            finally:
                con.close()
            if not row:
                return {}
            all_params = json.loads(row[0]) or {}
            return all_params.get(self.analysis_type) or {}
        except Exception:
            return {}

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        if len(df) < self.window_size:
            return ScanResult(matched=False)

        p = self.params
        c1 = df.iloc[-4]
        c2 = df.iloc[-3]
        c3 = df.iloc[-2]
        c4 = df.iloc[-1]

        # ── C1 (optional / advisory) ───────────────────────────────────────
        if p.get("c1_require_green") and float(c1["close"]) <= float(c1["open"]):
            return ScanResult(matched=False)

        # ── C2: big green (body >= threshold; wicks unconstrained) ─────────
        if not self._is_big_green(c2, p["c2_min_body_pct"]):
            return ScanResult(matched=False)

        # ── C3: doji (small body) ──────────────────────────────────────────
        if not self._is_doji(c3, p["c3_max_body_pct"]):
            return ScanResult(matched=False)

        # ── C4: doji (small body, signal candle) ───────────────────────────
        if not self._is_doji(c4, p["c4_max_body_pct"]):
            return ScanResult(matched=False)

        entry = round(float(c4["close"]), 2)
        sl    = round(float(min(c3["low"], c4["low"])), 2)

        return ScanResult(
            matched=True,
            details={"entry_close": entry, "stop_loss": sl},
            candle_date=str(df.index[-1]),
        )

    # ── helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _is_big_green(c, min_body_pct: float) -> bool:
        """Green candle whose body spans at least `min_body_pct` of its range.
        Wick shape is not constrained — strong green weeks often have meaningful
        lower wicks from intra-week pullbacks."""
        o, h, l, cl = float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"])
        rng = h - l
        if rng <= 0 or cl <= o:
            return False
        body = abs(cl - o)
        return body >= rng * (min_body_pct / 100)

    @staticmethod
    def _is_doji(c, max_body_pct: float) -> bool:
        """A doji is a candle whose body is small relative to its range.
        Wick shape is not constrained — a classic doji may have long wicks."""
        o, h, l, cl = float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"])
        rng = h - l
        if rng <= 0:
            return False
        body = abs(cl - o)
        return body <= rng * (max_body_pct / 100)
