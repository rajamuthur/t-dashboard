"""
Zerodha charge estimator — brokerage + STT + exchange (transaction) + SEBI +
stamp duty + GST, computed per leg.

Charges apply per order leg. While a trade is OPEN only the entry leg exists
(entry cost); once CLOSED the exit leg is added too. STT hits the SELL leg
(delivery: both), stamp duty the BUY leg — which leg is entry vs exit depends on
the trade's direction (buy = long, sell = short).

Rates verified Aug 2026 (Zerodha, after the 1 Apr 2026 STT hike). Zerodha has
revised these twice in ~2 years, so edit RATES here if they change again.
Source: https://zerodha.com/charges/
"""
from __future__ import annotations

_SEBI = 0.000001            # ₹10 per crore = 10 / 1e7, as a fraction of turnover
_GST = 0.18                 # on (brokerage + exchange + SEBI)

# Per-segment rates. brokerage: flat (fixed ₹/order) OR pct+cap (min(pct*turnover, cap)).
RATES: dict[str, dict] = {
    "equity_futures": {
        "brokerage_pct": 0.0003, "brokerage_cap": 20.0,
        "stt_sell": 0.0005, "stt_buy": 0.0,
        "exch": 0.0000183, "stamp_buy": 0.00002,
    },
    "equity_options": {
        "brokerage_flat": 20.0,
        "stt_sell": 0.0015, "stt_buy": 0.0,          # on premium, sell side
        "exch": 0.0003553, "stamp_buy": 0.00003,
    },
    "equity_delivery": {
        "brokerage_flat": 0.0,
        "stt_sell": 0.001, "stt_buy": 0.001,         # 0.1% both legs
        "exch": 0.0000307, "stamp_buy": 0.00015,
    },
    "equity_intraday": {
        "brokerage_pct": 0.0003, "brokerage_cap": 20.0,
        "stt_sell": 0.00025, "stt_buy": 0.0,
        "exch": 0.0000307, "stamp_buy": 0.00003,
    },
}


def _segment(trade: dict) -> str:
    it = (trade.get("instrument_type") or "equity").lower()
    if it == "future":
        return "equity_futures"
    if it == "option":
        return "equity_options"
    return "equity_delivery"   # equity default (positional). Intraday available in RATES.


def _qty(trade: dict) -> int:
    return int(trade.get("lot_size") or 1) * int(trade.get("num_lots") or 1)


def _leg_charge(seg: str, leg_side: str, turnover: float) -> float:
    """Total charges for one order leg (buy or sell) at the given turnover."""
    r = RATES.get(seg, RATES["equity_delivery"])
    if "brokerage_flat" in r:
        brokerage = r["brokerage_flat"]
    else:
        brokerage = min(r["brokerage_pct"] * turnover, r["brokerage_cap"])
    exch = r["exch"] * turnover
    sebi = _SEBI * turnover
    stt = (r["stt_sell"] if leg_side == "sell" else r["stt_buy"]) * turnover
    stamp = r["stamp_buy"] * turnover if leg_side == "buy" else 0.0
    gst = _GST * (brokerage + exch + sebi)
    return brokerage + exch + sebi + stt + stamp + gst


def estimate_charges(trade: dict) -> dict:
    """Estimated Zerodha charges for a trade → {entry_cost, exit_cost, charges}.
    entry_cost is always present; exit_cost is 0 until the trade is closed."""
    seg = _segment(trade)
    qty = _qty(trade)
    side = (trade.get("side") or "buy").lower()
    entry = float(trade.get("entry_price") or 0)

    # Entry leg: a long (buy) enters by buying; a short (sell) enters by selling.
    entry_leg = "buy" if side == "buy" else "sell"
    entry_cost = _leg_charge(seg, entry_leg, entry * qty)

    exit_cost = 0.0
    if trade.get("status") == "closed" and trade.get("exit_price"):
        exit_leg = "sell" if side == "buy" else "buy"
        exit_cost = _leg_charge(seg, exit_leg, float(trade["exit_price"]) * qty)

    return {
        "entry_cost": round(entry_cost, 2),
        "exit_cost": round(exit_cost, 2),
        "charges": round(entry_cost + exit_cost, 2),
    }
