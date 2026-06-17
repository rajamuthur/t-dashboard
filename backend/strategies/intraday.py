"""Four intraday 5-minute strategies. Thresholds are v1 defaults — tune after
the first backtest. Each emits Entry signals; the backtester handles exits."""
from typing import List, Optional

import numpy as np
import pandas as pd

from .base import Entry, IntradayStrategy


class ORBStrategy(IntradayStrategy):
    key = "orb"
    label = "Opening Range Breakout"
    description = ("Break of the first 15 min range; stop at the opposite end, 1.5R target. "
                   "Optional confirmation filters (volume / decisive close / prior-day bias / "
                   "OR-width) are available but OFF by default — on 5m data they tested no better.")
    OR_BARS = 3
    # Tunable filters (set on the instance to test variants). Defaults reproduce
    # plain ORB; the confirmation filters did NOT improve expectancy on the 60-day
    # 5m sample, so they ship OFF. Re-test with deeper history (Fyers) before relying on them.
    target_r = 1.5
    or_min_pct = 0.0           # OR-width gate disabled by default
    or_max_pct = 999.0
    latest = "14:45"           # allow breakouts through the session by default
    require_strong_close = False
    require_volume = False
    vol_mult = 1.2
    align_prior_day = False

    def generate(self, day: pd.DataFrame, prev_day: Optional[pd.DataFrame]) -> List[Entry]:
        n = len(day)
        if n < self.OR_BARS + 2:
            return []
        h = day["high"].to_numpy(float); l = day["low"].to_numpy(float)
        c = day["close"].to_numpy(float); v = day["volume"].to_numpy(float)
        orh = float(h[:self.OR_BARS].max()); orl = float(l[:self.OR_BARS].min())
        if orl <= 0 or orh <= orl:
            return []
        or_pct = (orh - orl) / orl * 100
        if not (self.or_min_pct <= or_pct <= self.or_max_pct):     # OR-width gate
            return []
        or_vol = float(v[:self.OR_BARS].mean())
        prev_close = float(prev_day["close"].iloc[-1]) if prev_day is not None and len(prev_day) else None

        for i in range(self.OR_BARS, n):
            if self._bar_time(day, i) >= self.latest:              # morning window only
                break
            px = float(c[i]); rng = max(h[i] - l[i], 1e-9)
            up, down = px > orh, px < orl
            if not (up or down):
                continue
            if self.require_strong_close:
                loc = (px - l[i]) / rng                            # close location in the bar
                if (up and loc < 0.70) or (down and loc > 0.30):
                    continue
            if self.require_volume and or_vol > 0 and v[i] < self.vol_mult * or_vol:
                continue
            if self.align_prior_day and prev_close:
                if (up and px < prev_close) or (down and px > prev_close):
                    continue
            if up:
                risk = px - orl
                if risk > 0:
                    return [Entry(i, "long", round(px, 2), round(orl, 2), round(px + self.target_r * risk, 2), "ORB long")]
            else:
                risk = orh - px
                if risk > 0:
                    return [Entry(i, "short", round(px, 2), round(orh, 2), round(px - self.target_r * risk, 2), "ORB short")]
        return []


class CPRStrategy(IntradayStrategy):
    key = "cpr"
    label = "CPR / Pivot"
    description = "Break above CPR (TC) targets R1; break below CPR (BC) targets S1. Levels from the prior day."

    def generate(self, day: pd.DataFrame, prev_day: Optional[pd.DataFrame]) -> List[Entry]:
        if prev_day is None or len(prev_day) < 1 or len(day) < 4:
            return []
        ph = float(prev_day["high"].max()); pl = float(prev_day["low"].min()); pc = float(prev_day["close"].iloc[-1])
        if pl <= 0:
            return []
        pivot = (ph + pl + pc) / 3
        bc = (ph + pl) / 2
        tc = 2 * pivot - bc
        hi, lo = max(tc, bc), min(tc, bc)
        r1 = 2 * pivot - pl
        s1 = 2 * pivot - ph
        c = day["close"].to_numpy(float)
        for i in range(2, len(day)):
            if self._too_late(day, i):
                break
            px = float(c[i])
            if hi < px < r1:                   # broke above CPR, room to R1
                return [Entry(i, "long", round(px, 2), round(lo, 2), round(r1, 2), "CPR long (>TC)")]
            if s1 < px < lo:                   # broke below CPR, room to S1
                return [Entry(i, "short", round(px, 2), round(hi, 2), round(s1, 2), "CPR short (<BC)")]
        return []


class VWAPStrategy(IntradayStrategy):
    key = "vwap"
    label = "VWAP trend"
    description = "Go with a close crossing the intraday VWAP; stop at the recent swing, 1.5R target."
    TARGET_R = 1.5

    def generate(self, day: pd.DataFrame, prev_day: Optional[pd.DataFrame]) -> List[Entry]:
        if len(day) < 5:
            return []
        h = day["high"].to_numpy(float); l = day["low"].to_numpy(float)
        c = day["close"].to_numpy(float); v = day["volume"].to_numpy(float)
        tp = (h + l + c) / 3
        cum_v = np.cumsum(v)
        vwap = np.where(cum_v > 0, np.cumsum(tp * v) / np.where(cum_v == 0, 1, cum_v), c)
        out: List[Entry] = []
        for i in range(3, len(day)):
            if self._too_late(day, i):
                break
            if c[i - 1] <= vwap[i - 1] and c[i] > vwap[i]:        # cross up
                stop = float(l[i - 3:i + 1].min()); risk = c[i] - stop
                if risk > 0:
                    out.append(Entry(i, "long", round(float(c[i]), 2), round(stop, 2), round(c[i] + self.TARGET_R * risk, 2), "VWAP cross up"))
            elif c[i - 1] >= vwap[i - 1] and c[i] < vwap[i]:      # cross down
                stop = float(h[i - 3:i + 1].max()); risk = stop - c[i]
                if risk > 0:
                    out.append(Entry(i, "short", round(float(c[i]), 2), round(stop, 2), round(c[i] - self.TARGET_R * risk, 2), "VWAP cross down"))
        return out


class TightBreakoutStrategy(IntradayStrategy):
    key = "tight_breakout"
    label = "Intraday Tight-Range Breakout"
    description = "Coiled 30-min range (<0.6% band) then a 5m breakout; stop at the range's far side, 1.5R."
    W = 6
    MAX_BAND = 0.006
    TARGET_R = 1.5

    def generate(self, day: pd.DataFrame, prev_day: Optional[pd.DataFrame]) -> List[Entry]:
        if len(day) < self.W + 2:
            return []
        h = day["high"].to_numpy(float); l = day["low"].to_numpy(float); c = day["close"].to_numpy(float)
        out: List[Entry] = []
        for i in range(self.W, len(day)):
            if self._too_late(day, i):
                break
            wh = float(h[i - self.W:i].max()); wl = float(l[i - self.W:i].min())
            if wl <= 0 or (wh - wl) / wl > self.MAX_BAND:
                continue
            if c[i] > wh:
                risk = c[i] - wl
                if risk > 0:
                    out.append(Entry(i, "long", round(float(c[i]), 2), round(wl, 2), round(c[i] + self.TARGET_R * risk, 2), "Tight breakout up"))
            elif c[i] < wl:
                risk = wh - c[i]
                if risk > 0:
                    out.append(Entry(i, "short", round(float(c[i]), 2), round(wh, 2), round(c[i] - self.TARGET_R * risk, 2), "Tight breakdown"))
        return out
