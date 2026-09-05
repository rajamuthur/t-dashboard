"""
Backtest the Gap-Reversal strategy over the synced daily candles.

For every signal (entry = next open, stop = signal-day low/high) one forward walk
(≤ max_hold_bars) records the outcome under EACH exit rule:
  - fixed R:R targets in cfg["rr_targets"] (e.g. 3/5/7/10), and
  - an EMA-trailing exit (close back below EMA for longs / above for shorts, or stop).

Same-bar target+stop counts as a LOSS (conservative). Neither hit within the
window → timeout (exit at that bar's close). Reports wins/losses/timeouts,
win-rate, avg R, total R and expectancy per exit rule — overall, per direction,
and per stock.
"""
import asyncio
import sqlite3
from datetime import datetime, timezone

import numpy as np

from .db import _get_db_path
from .gap_reversal_scan import _load, compute, signal_at, get_config
from .universe_service import get_universe_stocks

_bt_status: dict = {}
_bt_result: dict = {}
INF = float("inf")


def get_bt_status() -> dict:
    return dict(_bt_status)


def get_bt_result() -> dict:
    return dict(_bt_result)


def _simulate(a: dict, i: int, direction: str, cfg: dict) -> dict | None:
    """One signal → per-exit outcomes. i = gap bar; entry at next open (i+1)."""
    n = len(a["c"])
    if i + 1 >= n:
        return None
    entry = float(a["o"][i + 1])
    if direction == "BULL":
        stop = float(a["l"][i]); risk = entry - stop
    else:
        stop = float(a["h"][i]); risk = stop - entry
    if risk <= 0:
        return None

    end = min(i + int(cfg["max_hold_bars"]), n - 1)
    s = slice(i + 1, end + 1)
    hi, lo, cl, em = a["h"][s], a["l"][s], a["c"][s], a["ema"][s]
    if len(cl) == 0:
        return None

    def first(mask) -> float:
        w = np.where(mask)[0]
        return float(w[0]) if len(w) else INF

    if direction == "BULL":
        stop_bar = first(lo <= stop)
        ema_bar = first(cl < em)
        last_r = (cl[-1] - entry) / risk
    else:
        stop_bar = first(hi >= stop)
        ema_bar = first(cl > em)
        last_r = (entry - cl[-1]) / risk

    per_target: dict[str, tuple[str, float]] = {}
    for k in cfg["rr_targets"]:
        target = entry + k * risk if direction == "BULL" else entry - k * risk
        tbar = first(hi >= target) if direction == "BULL" else first(lo <= target)
        if tbar < stop_bar:
            per_target[str(k)] = ("win", float(k))
        elif stop_bar < INF and stop_bar <= tbar:
            per_target[str(k)] = ("loss", -1.0)          # same-bar → stop first (conservative)
        else:
            per_target[str(k)] = ("timeout", round(last_r, 3))

    # EMA-trailing exit: whichever of stop / ema-cross comes first, else timeout.
    if stop_bar == INF and ema_bar == INF:
        ema_exit = ("timeout", round(last_r, 3))
    elif stop_bar <= ema_bar:
        ema_exit = ("stop", -1.0)
    else:
        j = int(ema_bar)
        r = (cl[j] - entry) / risk if direction == "BULL" else (entry - cl[j]) / risk
        ema_exit = ("ema", round(float(r), 3))

    return {"direction": direction, "gap_date": a["dates"][i][:10], "entry_date": a["dates"][i + 1][:10],
            "entry": round(entry, 2), "stop": round(stop, 2), "risk": round(risk, 2),
            "per_target": per_target, "ema_exit": ema_exit}


def _blank_stats() -> dict:
    return {"n": 0, "wins": 0, "losses": 0, "timeouts": 0, "total_R": 0.0}


def _accumulate(stats: dict, outcome: str, r: float) -> None:
    stats["n"] += 1
    stats["total_R"] += r
    if outcome in ("win", "ema") and r > 0:
        stats["wins"] += 1
    elif outcome == "timeout":
        stats["timeouts"] += 1
        (stats.__setitem__("wins", stats["wins"] + 1) if r > 0 else stats.__setitem__("losses", stats["losses"] + 1))
    else:
        stats["losses"] += 1


def _finalize(stats: dict) -> dict:
    n = stats["n"] or 1
    return {
        "signals": stats["n"], "wins": stats["wins"], "losses": stats["losses"], "timeouts": stats["timeouts"],
        "win_rate": round(stats["wins"] / n * 100, 1),
        "total_R": round(stats["total_R"], 2),
        "avg_R": round(stats["total_R"] / n, 3),
    }


def _run_sync(stocks, cfg, status) -> dict:
    con = sqlite3.connect(_get_db_path())
    tf = cfg["timeframe"]
    min_bars = int(cfg["ema_length"]) + int(cfg["rsi_length"]) + 5
    exits = [str(k) for k in cfg["rr_targets"]] + ["ema"]
    overall = {e: _blank_stats() for e in exits}
    by_dir = {"BULL": {e: _blank_stats() for e in exits}, "BEAR": {e: _blank_stats() for e in exits}}
    per_stock: list[dict] = []
    samples: list[dict] = []
    total_signals = 0

    total = len(stocks)
    for si, sym in enumerate(stocks):
        status.update({"current": sym.replace("NSE:", "").replace("-EQ", ""), "done": si, "total": total,
                       "step": f"{si + 1}/{total}"})
        try:
            df = _load(con, sym, tf)
            if len(df) < min_bars:
                continue
            a = compute(df, cfg)
            sym_stats = {e: _blank_stats() for e in exits}
            sym_signals = 0
            for i in range(1, len(a["c"]) - 1):     # -1: need a next open to enter
                d = signal_at(a, i, cfg)
                if not d:
                    continue
                sim = _simulate(a, i, d, cfg)
                if not sim:
                    continue
                sym_signals += 1
                total_signals += 1
                for k, (oc, r) in sim["per_target"].items():
                    _accumulate(overall[k], oc, r); _accumulate(by_dir[d][k], oc, r); _accumulate(sym_stats[k], oc, r)
                oc, r = sim["ema_exit"]
                _accumulate(overall["ema"], "ema" if oc == "ema" else oc, r)
                _accumulate(by_dir[d]["ema"], "ema" if oc == "ema" else oc, r)
                _accumulate(sym_stats["ema"], "ema" if oc == "ema" else oc, r)
                if len(samples) < 60:
                    samples.append({"symbol": sym.replace("NSE:", "").replace("-EQ", ""), **sim})
            if sym_signals:
                per_stock.append({"symbol": sym.replace("NSE:", "").replace("-EQ", ""), "signals": sym_signals,
                                  "total_R": {e: round(sym_stats[e]["total_R"], 2) for e in exits}})
        except Exception:
            continue
    con.close()
    per_stock.sort(key=lambda r: r["signals"], reverse=True)
    return {
        "total_signals": total_signals,
        "scanned": total,
        "by_exit": {e: _finalize(overall[e]) for e in exits},
        "by_direction": {d: {e: _finalize(by_dir[d][e]) for e in exits} for d in ("BULL", "BEAR")},
        "per_stock": per_stock[:100],
        "samples": samples,
    }


async def run_backtest(cfg: dict | None = None) -> dict:
    global _bt_status, _bt_result
    cfg = cfg or await get_config()
    _bt_status = {"status": "running", "step": "Resolving universe…", "universe": cfg["universe"]}
    try:
        stocks = await get_universe_stocks(cfg["universe"])
        _bt_status.update({"step": f"Backtesting {len(stocks)} stocks…", "total": len(stocks)})
        res = await asyncio.to_thread(_run_sync, stocks, cfg, _bt_status)
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _bt_result = {"at": at, "params": dict(cfg), **res}
        _bt_status = {"status": "completed", "at": at, "total_signals": res["total_signals"], "scanned": res["scanned"]}
        return _bt_result
    except Exception as exc:
        _bt_status = {"status": "failed", "message": str(exc)}
        raise
