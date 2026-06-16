"""
VCP — Minervini Volatility Contraction Pattern (bullish, breakout entry).

Two-part setup straight out of *Trade Like a Stock Market Wizard* (Ch. 10) and
its companion *Think & Trade Like a Champion*:

  1. TREND TEMPLATE GATE (hard, non-negotiable). The stock must already be in a
     Stage-2 uptrend. We enforce criteria 1-7 of Minervini's 8-point template
     (price vs 50/150/200 MAs, MA stacking, 200-MA rising, 30% off the 52-week
     low, within 25% of the 52-week high). Criterion 8 (RS rank vs the market)
     needs a relative-strength universe we don't have, so it is SKIPPED and
     documented — the one criterion not enforced.

  2. VOLATILITY CONTRACTION. Inside the base, a succession of 2-6 pullbacks
     ("Ts") each tighter than the last (each ~half ± the prior), with volume
     drying up at the tightest, rightmost contraction. The pivot = the high of
     the last contraction; buy on a breakout above it on expanding volume.

MA periods and base/range lengths are TIMEFRAME-AWARE (the book's 50/150/200
*day* MAs are 10/30/40 *week* MAs). Indicators are precomputed once over the
full series; `scan_history` is overridden so the trailing lookback can vary by
timeframe without forcing a giant fixed `window_size`.

See docs/strategies/minervini-trade-like-a-wizard.md for the full methodology.
Heuristic + vectorised; thresholds are tunable.
"""
import math

import numpy as np
import pandas as pd

from .base import BaseScanner, ScanResult

# Trend-template moving averages per timeframe: (short, mid, long).
# Daily 50/150/200d == weekly 10/30/40w (Minervini's own equivalence).
TREND_MA = {
    "day":   (50, 150, 200),
    "week":  (10, 30, 40),
    "month": (6, 10, 12),
}
# Lookback (in candles) for "the long MA is trending up" (~1 month).
SLOPE_LB = {"day": 22, "week": 4, "month": 2}
# 52-week high/low window in candles.
RANGE_LEN = {"day": 252, "week": 52, "month": 12}
# Recent region that holds the contraction base.
# VCP base region length now comes from min_months (duration_candles); the
# Trend-Template MA/52-week history below still gates the earliest scannable index.
# Zigzag reversal threshold — must be small enough to catch a ~3-5% final T.
REVERSAL = {"day": 0.04, "week": 0.05, "month": 0.06}

# Contraction-shape gates.
MIN_TS = 2                 # at least two contractions ("Ts")
MAX_TS = 6                 # Minervini: 2-6, typically 2-4; more == choppy, reject
DEEP_MIN = 0.08            # deepest contraction must be a real correction...
DEEP_MAX = 0.35            # ...but a base contraction, not a major correction/crash
BASE_HIGH_SPREAD = 0.18    # contraction highs must cluster within this of the pivot (a consolidation under a ceiling, not a trending advance)
FINAL_TIGHT_MAX = 0.10     # final (tightest) contraction <= this
TIGHT_VS_DEEP = 0.60       # final must have contracted to <= 60% of the deepest
NEAR_PIVOT = 0.08          # signal fires only while price is coiled under the pivot
TARGET_R_FALLBACK = 2.5    # if measured move is below this R, use R-multiple target


class VCPScanner(BaseScanner):
    analysis_type = "vcp"
    # Low floor so weekly/monthly symbols aren't skipped by the pipeline's
    # `len(rows) < window_size` guard. The real per-timeframe lookback is
    # enforced inside scan_history/_detect_at.
    window_size = 40
    direction = "bullish"

    legend = [
        {"label": "Contractions", "color": "#a855f7", "text": "Volatility 'Ts' (high to low)"},
        {"label": "Pivot/Entry",  "color": "#22c55e", "text": "Breakout above last contraction high"},
        {"label": "Stop",         "color": "#ef4444", "text": "Below the final (tight) low"},
        {"label": "Target",       "color": "#3b82f6", "text": "Measured move (deepest correction)"},
    ]

    # ------------------------------------------------------------------ #
    # Indicators (computed once over the full series).
    # ------------------------------------------------------------------ #
    @staticmethod
    def _indicators(df: pd.DataFrame, timeframe: str) -> dict:
        s, m, l = TREND_MA.get(timeframe, TREND_MA["day"])
        rng = RANGE_LEN.get(timeframe, RANGE_LEN["day"])
        close = df["close"].astype(float)
        return {
            "ma_s": close.rolling(s).mean().to_numpy(),
            "ma_m": close.rolling(m).mean().to_numpy(),
            "ma_l": close.rolling(l).mean().to_numpy(),
            "low52": df["low"].astype(float).rolling(rng).min().to_numpy(),
            "high52": df["high"].astype(float).rolling(rng).max().to_numpy(),
            "close": close.to_numpy(),
            "high": df["high"].astype(float).to_numpy(),
            "low": df["low"].astype(float).to_numpy(),
            "vol": pd.to_numeric(df["volume"], errors="coerce").fillna(0).to_numpy(dtype=float),
        }

    @staticmethod
    def _trend_template(ind: dict, i: int, timeframe: str) -> bool:
        """Minervini Trend Template criteria 1-7 at position i (8/RS skipped)."""
        slope_lb = SLOPE_LB.get(timeframe, SLOPE_LB["day"])
        ma_s, ma_m, ma_l = ind["ma_s"][i], ind["ma_m"][i], ind["ma_l"][i]
        if any(math.isnan(x) for x in (ma_s, ma_m, ma_l)):
            return False
        if i - slope_lb < 0 or math.isnan(ind["ma_l"][i - slope_lb]):
            return False
        c = ind["close"][i]
        low52, high52 = ind["low52"][i], ind["high52"][i]
        if math.isnan(low52) or math.isnan(high52) or low52 <= 0 or high52 <= 0:
            return False
        return (
            c > ma_m and c > ma_l and            # (1) price above 150 & 200
            ma_m > ma_l and                       # (2) 150 above 200
            ma_l > ind["ma_l"][i - slope_lb] and  # (3) 200 trending up ~1mo
            ma_s > ma_m and ma_s > ma_l and       # (4) 50 above 150 & 200
            c > ma_s and                          # (5) price above 50
            c >= low52 * 1.30 and                 # (6) >= 30% above 52wk low
            c >= high52 * 0.75                    # (7) within 25% of 52wk high
            # (8) RS rank >= 70 — SKIPPED (no market-relative universe)
        )

    # ------------------------------------------------------------------ #
    # Zigzag — alternating swing highs/lows by a % reversal threshold.
    # ------------------------------------------------------------------ #
    @staticmethod
    def _zigzag(highs: np.ndarray, lows: np.ndarray, pct: float) -> list[tuple[int, float, str]]:
        n = len(highs)
        if n < 3:
            return []
        piv: list[tuple[int, float, str]] = []
        trend = 0  # 0 unknown, 1 up (tracking a high), -1 down (tracking a low)
        hi_i, hi = 0, highs[0]
        lo_i, lo = 0, lows[0]
        for j in range(1, n):
            if highs[j] > hi:
                hi, hi_i = highs[j], j
            if lows[j] < lo:
                lo, lo_i = lows[j], j
            if trend >= 0 and lows[j] <= hi * (1 - pct):
                piv.append((hi_i, float(hi), "H"))
                trend = -1
                lo, lo_i = lows[j], j
            elif trend <= 0 and highs[j] >= lo * (1 + pct):
                piv.append((lo_i, float(lo), "L"))
                trend = 1
                hi, hi_i = highs[j], j
        # close out with the final running extreme
        if trend == 1:
            piv.append((hi_i, float(hi), "H"))
        elif trend == -1:
            piv.append((lo_i, float(lo), "L"))
        return piv

    def window_for(self, timeframe: str) -> int:
        s, m, l = TREND_MA.get(timeframe, TREND_MA["day"])
        rng = RANGE_LEN.get(timeframe, RANGE_LEN["day"])
        slope_lb = SLOPE_LB.get(timeframe, SLOPE_LB["day"])
        return max(l + slope_lb, rng, self.duration_candles(timeframe))

    def _detect_at(self, df: pd.DataFrame, i: int, timeframe: str, ind: dict) -> ScanResult:
        base_len = self.duration_candles(timeframe)
        if i < base_len:
            return ScanResult(matched=False)
        # 1) Stage-2 / Trend Template gate (hard).
        if not self._trend_template(ind, i, timeframe):
            return ScanResult(matched=False)

        # 2) Contraction structure in the recent base (offsets are absolute idx).
        lo_abs = i - base_len + 1
        highs = ind["high"][lo_abs : i + 1]
        lows = ind["low"][lo_abs : i + 1]
        pct = REVERSAL.get(timeframe, REVERSAL["day"])
        piv = self._zigzag(highs, lows, pct)
        if len(piv) < 3:
            return ScanResult(matched=False)

        # Contractions = each high immediately followed by a low (a down-leg "T").
        contractions = []  # (h_idx_abs, h_price, l_idx_abs, l_price, depth)
        for k in range(len(piv) - 1):
            (hi_i, hi_p, kind), (lo_i, lo_p, kind2) = piv[k], piv[k + 1]
            if kind == "H" and kind2 == "L" and hi_p > 0:
                depth = (hi_p - lo_p) / hi_p
                contractions.append((lo_abs + hi_i, hi_p, lo_abs + lo_i, lo_p, depth))
        t_count = len(contractions)
        if not (MIN_TS <= t_count <= MAX_TS):
            return ScanResult(matched=False)

        depths = [c[4] for c in contractions]
        deepest = max(depths)
        tightest = depths[-1]                 # final (rightmost) contraction
        # Defining VCP traits: a real first correction, a tight final one, and
        # volatility that contracted from left to right.
        if not (DEEP_MIN <= deepest <= DEEP_MAX):
            return ScanResult(matched=False)
        if tightest > FINAL_TIGHT_MAX:
            return ScanResult(matched=False)
        if tightest > deepest * TIGHT_VS_DEEP:
            return ScanResult(matched=False)
        if depths[0] < tightest:              # first leg must be deeper than the last
            return ScanResult(matched=False)
        if tightest > min(depths) * 1.15:     # final must be (near) the tightest leg
            return ScanResult(matched=False)
        # Volatility must be FRONT-LOADED (genuinely contracting), not erratic /
        # expanding mid-base: the deepest contraction sits in the first half.
        if depths.index(deepest) > (len(depths) - 1) // 2:
            return ScanResult(matched=False)

        # A VCP is a CONSOLIDATION under a pivot ceiling — the contraction highs
        # must cluster near a common level, not make new highs across the whole
        # move (that's a trending advance, not a base).
        c_highs = [c[1] for c in contractions]
        pivot = contractions[-1][1]
        if pivot <= 0 or (max(c_highs) - min(c_highs)) / pivot > BASE_HIGH_SPREAD:
            return ScanResult(matched=False)

        # Pivot = high of the LAST contraction; signal must be coiled under it
        # (not already broken out) so the forward outcome eval can confirm.
        last = contractions[-1]
        final_low = last[3]
        close_i = ind["close"][i]
        if pivot <= 0 or final_low <= 0 or close_i <= 0:
            return ScanResult(matched=False)
        if not (pivot * (1 - NEAR_PIVOT) <= close_i <= pivot * 1.01):
            return ScanResult(matched=False)

        # 3) Volume dry-up at the tightest contraction (when volume is available).
        vol = ind["vol"]
        base_vol = vol[lo_abs : i + 1]
        fc_lo, fc_hi = last[0], last[2]
        final_vol = vol[fc_lo : fc_hi + 1]
        base_avg = float(np.mean(base_vol)) if len(base_vol) else 0.0
        final_avg = float(np.mean(final_vol)) if len(final_vol) else 0.0
        if base_avg > 0 and final_avg > 0:
            if final_avg > base_avg * 1.05:   # volume expanding into the base → not a VCP
                return ScanResult(matched=False)
            volume_trend = "dry-up" if final_avg <= base_avg * 0.85 else "flat"
        else:
            volume_trend = "unknown"

        # Levels. Stop just under the final low; measured-move target from the
        # deepest correction, floored at a sensible reward:risk multiple.
        stop = round(final_low, 2)
        entry = round(pivot, 2)
        risk = entry - stop
        if risk <= 0:
            return ScanResult(matched=False)
        mm_target = pivot * (1 + deepest)
        target = round(max(mm_target, entry + risk * TARGET_R_FALLBACK), 2)

        # Footprint: Time(weeks) / Price(deepest/tightest) / Symmetry(Ts).
        first_h_idx = contractions[0][0]
        per_week = {"day": 5.0, "week": 1.0, "month": 0.231}.get(timeframe, 5.0)
        base_weeks = max(1, round((i - first_h_idx) / per_week))
        deepest_pct = round(deepest * 100, 1)
        tightest_pct = round(tightest * 100, 1)
        footprint = f"{base_weeks}W {round(deepest_pct)}/{round(tightest_pct)} {t_count}T"

        # Shapes — zigzag path across the base + level lines + depth markers.
        zz_points = [{"date": str(df.index[lo_abs + idx]), "price": round(p, 2)}
                     for (idx, p, _k) in piv]
        markers = [{"type": "marker", "date": str(df.index[c[2]]), "price": c[3],
                    "color": "#a855f7", "position": "belowBar",
                    "text": f"-{round(c[4] * 100)}%"} for c in contractions]
        shapes = [
            {"type": "polyline", "color": "#a855f7", "label": "Contractions", "points": zz_points},
            *markers,
            {"type": "hline", "price": entry,  "color": "#22c55e", "label": "Pivot / Entry"},
            {"type": "hline", "price": stop,   "color": "#ef4444", "label": "Stop"},
            {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
        ]

        details = {
            "direction": "bullish",
            "subtype": f"{t_count}T",
            "entry_mode": "breakout",
            "breakout_level": entry,
            "entry_close": entry,
            "stop_loss": stop,
            "target": target,
            "pivot": entry,
            "t_count": t_count,
            "contractions": [round(d * 100, 1) for d in depths],
            "deepest_pct": deepest_pct,
            "tightest_pct": tightest_pct,
            "base_weeks": base_weeks,
            "footprint": footprint,
            "volume_trend": volume_trend,
            "trend_template": True,
            "shapes": shapes,
        }
        return ScanResult(matched=True, details=details, candle_date=str(df.index[i]))

    # ------------------------------------------------------------------ #
    # Public scan API.
    # ------------------------------------------------------------------ #
    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        """Live single signal: evaluate the most recent candle."""
        if len(df) < self.duration_candles(timeframe):
            return ScanResult(matched=False)
        ind = self._indicators(df, timeframe)
        return self._detect_at(df, len(df) - 1, timeframe, ind)

    def scan_history(self, symbol: str, timeframe: str, df: pd.DataFrame):
        """Slide a timeframe-aware lookback; one indicator pass over the series."""
        results = []
        if df.empty:
            return results
        ind = self._indicators(df, timeframe)
        s, m, l = TREND_MA.get(timeframe, TREND_MA["day"])
        rng = RANGE_LEN.get(timeframe, RANGE_LEN["day"])
        slope_lb = SLOPE_LB.get(timeframe, SLOPE_LB["day"])
        base_len = self.duration_candles(timeframe)
        # Earliest index where every gate has enough history.
        start = max(l + slope_lb, rng, base_len)
        for i in range(start, len(df)):
            res = self._detect_at(df, i, timeframe, ind)
            if res.matched:
                results.append(res)
        return results
