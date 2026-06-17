"""Four intraday 5-minute strategies. Thresholds are v1 defaults — tune after
the first backtest. Each emits Entry signals; the backtester handles exits."""
from typing import List, Optional

import numpy as np
import pandas as pd

from .base import Entry, IntradayStrategy


class ORBStrategy(IntradayStrategy):
    key = "orb"
    label = "Opening Range Breakout"
    description = "Break of the first 15 min (3 bars) high/low; stop at the opposite end, 1.5R target."
    OR_BARS = 3
    TARGET_R = 1.5

    def generate(self, day: pd.DataFrame, prev_day: Optional[pd.DataFrame]) -> List[Entry]:
        if len(day) < self.OR_BARS + 2:
            return []
        h = day["high"].to_numpy(float); l = day["low"].to_numpy(float); c = day["close"].to_numpy(float)
        orh = float(h[:self.OR_BARS].max()); orl = float(l[:self.OR_BARS].min())
        if orl <= 0 or orh <= orl:
            return []
        for i in range(self.OR_BARS, len(day)):
            if self._too_late(day, i):
                break
            px = float(c[i])
            if px > orh:                       # first breakout up
                risk = px - orl
                if risk > 0:
                    return [Entry(i, "long", round(px, 2), round(orl, 2), round(px + self.TARGET_R * risk, 2), "ORB long")]
            elif px < orl:                     # first breakdown
                risk = orh - px
                if risk > 0:
                    return [Entry(i, "short", round(px, 2), round(orh, 2), round(px - self.TARGET_R * risk, 2), "ORB short")]
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
