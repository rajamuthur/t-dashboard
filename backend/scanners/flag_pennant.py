"""
Flag & Pennant — trend-continuation patterns.

A sharp directional move (the 'pole') followed by a short counter-trend or
sideways consolidation (the 'flag' channel, or a converging 'pennant').
Breakout in the pole's direction targets a measured move = pole height.

Heuristic detector: thresholds are tunable and will produce some false
positives; tighten POLE_MIN_MOVE_PCT / POLE_MIN_R2 to be stricter.
"""
import numpy as np
import pandas as pd
from .base import BaseScanner, ScanResult
from ._trend import LEAD, trend_aligned
from ._pivots import swing_pivots

PATTERN_LEN = 25          # pole + consolidation (the drawn pattern)
POLE_FRAC = 0.4            # fraction of the pattern window that is the pole
POLE_MIN_MOVE_PCT = 6.0    # min |% move| across the pole
POLE_MIN_R2 = 0.55         # pole must be reasonably monotonic
MAX_RETRACE = 0.5          # consolidation may retrace at most this fraction of the pole
CONSOLIDATION_MIN = 5      # need at least this many consolidation candles
# Consolidation tightness cap as % of price — timeframe-aware (weekly/monthly
# candles have naturally wider ranges than daily). The primary tightness rule is
# CHANNEL_MAX_POLE_FRAC (a real flag is smaller than its pole); this %-cap just
# excludes degenerate huge ranges.
CHANNEL_MAX_PCT = {"day": 8.0, "week": 16.0, "month": 28.0}
CHANNEL_MAX_PCT_DEFAULT = 12.0
CHANNEL_MAX_POLE_FRAC = 0.6  # channel range must be <= this fraction of the pole height


def _slope_r2(y: np.ndarray):
    x = np.arange(len(y))
    if len(y) < 2:
        return 0.0, 0.0
    slope, intercept = np.polyfit(x, y, 1)
    fit = slope * x + intercept
    ss_res = float(np.sum((y - fit) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-9
    r2 = 1 - ss_res / ss_tot
    return float(slope), float(r2)


class FlagPennantScanner(BaseScanner):
    analysis_type = "flag_pennant"

    def window_for(self, timeframe: str) -> int:
        # Flag body stays short by nature; require >= min_months of prior trend.
        return PATTERN_LEN + self.duration_candles(timeframe)

    legend = [
        {"label": "Pole",    "color": "#a855f7", "text": "Sharp directional move"},
        {"label": "Channel", "color": "#f59e0b", "text": "Consolidation (flag/pennant)"},
        {"label": "Entry",   "color": "#22c55e", "text": "Breakout level"},
        {"label": "Stop",    "color": "#ef4444", "text": "Opposite side of channel"},
        {"label": "Target",  "color": "#3b82f6", "text": "Entry +/- pole height"},
    ]

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> ScanResult:
        n = PATTERN_LEN
        if len(df) < n:
            return ScanResult(matched=False)
        w = df.iloc[-n:]
        lead = df.iloc[:-n]              # trend context before the pattern
        pole_len = max(3, round(n * POLE_FRAC))
        pole = w.iloc[:pole_len]
        cons = w.iloc[pole_len:]
        if len(cons) < CONSOLIDATION_MIN:
            return ScanResult(matched=False)

        closes = pole["close"].values.astype(float)
        p_start, p_end = closes[0], closes[-1]
        if p_start <= 0:
            return ScanResult(matched=False)
        move_pct = (p_end - p_start) / p_start * 100
        _, pole_r2 = _slope_r2(closes)
        if abs(move_pct) < POLE_MIN_MOVE_PCT or pole_r2 < POLE_MIN_R2:
            return ScanResult(matched=False)

        bull = move_pct > 0
        # Only continuation WITH the medium-term trend (pole agrees with trend).
        if not trend_aligned(lead, "bullish" if bull else "bearish"):
            return ScanResult(matched=False)
        pole_low = float(pole["low"].min())
        pole_high = float(pole["high"].max())
        pole_height = pole_high - pole_low
        if pole_height <= 0:
            return ScanResult(matched=False)

        highs = cons["high"].values.astype(float)
        lows = cons["low"].values.astype(float)
        slope_high, _ = _slope_r2(highs)
        slope_low, _ = _slope_r2(lows)
        cons_high = float(highs.max())
        cons_low = float(lows.min())

        # A real flag is a TIGHT pause — reject loose/wide "channels".
        cons_close = float(cons["close"].iloc[-1])
        channel_range = cons_high - cons_low
        if cons_close <= 0 or channel_range <= 0:
            return ScanResult(matched=False)
        channel_pct = channel_range / cons_close * 100
        max_pct = CHANNEL_MAX_PCT.get(timeframe, CHANNEL_MAX_PCT_DEFAULT)
        if channel_pct > max_pct:
            return ScanResult(matched=False)
        if channel_range > CHANNEL_MAX_POLE_FRAC * pole_height:
            return ScanResult(matched=False)

        # Consolidation must not retrace more than MAX_RETRACE of the pole.
        if bull:
            if cons_low < pole_high - MAX_RETRACE * pole_height:
                return ScanResult(matched=False)
            # flag: drifts down/sideways; pennant: converges.
            if slope_high <= 0 and slope_low <= 0:
                subtype = "bull_flag"
            elif slope_high < 0 and slope_low > 0:
                subtype = "bull_pennant"
            else:
                return ScanResult(matched=False)
        else:
            if cons_high > pole_low + MAX_RETRACE * pole_height:
                return ScanResult(matched=False)
            if slope_high >= 0 and slope_low >= 0:
                subtype = "bear_flag"
            elif slope_high < 0 and slope_low > 0:
                subtype = "bear_pennant"
            else:
                return ScanResult(matched=False)

        # Entry = breakout level; stop = opposite channel side; target = measured move.
        if bull:
            entry = cons_high
            stop = cons_low
            target = entry + pole_height
        else:
            entry = cons_low
            stop = cons_high
            target = entry - pole_height
        risk = abs(entry - stop)
        if risk <= 0:
            return ScanResult(matched=False)
        entry, stop, target = round(entry, 2), round(stop, 2), round(target, 2)

        # Geometry for drawing.
        pole_start_date = str(pole.index[0])
        pole_end_date = str(pole.index[-1])
        cons_start_date = str(cons.index[0])
        cons_end_date = str(cons.index[-1])
        # Channel lines anchored to REAL swing highs/lows of the consolidation
        # (not regression endpoints), so they ride the actual touches. Fall back
        # to the linear-fit endpoints when the pause is too short for >=2 pivots.
        cons_dates = [str(d) for d in cons.index]
        csh, csl = swing_pivots(cons, k=2)
        hi_fit0 = float(slope_high * 0 + highs[0]); hi_fit1 = float(slope_high * (len(highs) - 1) + highs[0])
        lo_fit0 = float(slope_low * 0 + lows[0]);   lo_fit1 = float(slope_low * (len(lows) - 1) + lows[0])

        def _chan(pivots, fb0_date, fb0, fb1_date, fb1):
            if len(pivots) >= 2:
                (i0, p0), (i1, p1) = pivots[0], pivots[-1]
                return [{"date": cons_dates[i0], "price": round(p0, 2)},
                        {"date": cons_dates[i1], "price": round(p1, 2)}]
            return [{"date": fb0_date, "price": round(fb0, 2)},
                    {"date": fb1_date, "price": round(fb1, 2)}]

        chan_high_pts = _chan(csh, cons_start_date, hi_fit0, cons_end_date, hi_fit1)
        chan_low_pts = _chan(csl, cons_start_date, lo_fit0, cons_end_date, lo_fit1)

        details = {
            "direction": "bullish" if bull else "bearish",
            "subtype": subtype,
            "entry_mode": "breakout",       # only "enter" when price breaks the channel
            "breakout_level": entry,        # bull: channel high; bear: channel low
            "channel_pct": round(channel_pct, 2),
            "pole_pct": round(move_pct, 2),
            "pole_height": round(pole_height, 2),
            "pole_r2": round(pole_r2, 2),
            "entry_close": entry,
            "stop_loss": stop,
            "target": target,
            "shapes": [
                {"type": "trendline", "color": "#a855f7", "label": "Pole",
                 "points": [{"date": pole_start_date, "price": round(float(p_start), 2)},
                            {"date": pole_end_date,   "price": round(float(p_end), 2)}]},
                {"type": "trendline", "color": "#f59e0b", "label": "Channel high", "points": chan_high_pts},
                {"type": "trendline", "color": "#f59e0b", "label": "Channel low", "points": chan_low_pts},
                {"type": "hline", "price": entry,  "color": "#22c55e", "label": "Entry"},
                {"type": "hline", "price": stop,   "color": "#ef4444", "label": "Stop"},
                {"type": "hline", "price": target, "color": "#3b82f6", "label": "Target"},
            ],
        }
        return ScanResult(matched=True, details=details, candle_date=cons_end_date)
