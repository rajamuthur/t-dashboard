"""
Gap-Reversal indicator + scanner (Kirubakaran / Vivek-Bajaj style, 1:N R:R).

Indicator (all configurable, persisted in config.gap_reversal_config):
  - EMA(ema_length) of close.
  - RSI(rsi_length) computed ON the EMA line (Wilder) — a double-smoothed RSI.
  - RSI-based MA = SMA(rsi, rsi_ma_length)  [displayed only].
  - Bands: upper / middle / lower (default 90 / 50 / 10).

Signal (reversal off exhaustion + breakaway gap):
  - BULL: RSI-on-EMA in extreme-oversold (<= band_lower) going into a bar that
          gaps UP >= gap_pct → long. Entry = next open, stop = signal-day low.
  - BEAR: RSI-on-EMA extreme-overbought (>= band_upper) + gap DOWN >= gap_pct →
          short. Entry = next open, stop = signal-day high.
  - Targets: entry ± k×risk for each k in rr_targets.

Reads the synced `candles` table (no per-symbol network), like ema_scan.py.
"""
import asyncio
import json
import sqlite3
from datetime import datetime, timezone

import aiosqlite
import numpy as np
import pandas as pd

from .db import _get_db_path
from .universe_service import get_universe_stocks

DEFAULT_CFG = {
    "ema_length": 21,
    "ema_source": "close",
    "rsi_length": 14,          # RSI computed on the EMA line
    "rsi_ma_length": 14,       # SMA of RSI (display only)
    "band_upper": 90.0,
    "band_middle": 50.0,
    "band_lower": 10.0,
    "gap_pct": 1.5,            # |open-prevclose|/prevclose % that qualifies as a breakaway gap
    "rr_targets": [3, 5, 7, 10],
    "max_hold_bars": 40,       # bars to wait for target/stop before timing out
    "universe": "fo",
    "timeframe": "day",
    "direction": "both",       # both | bull | bear
    "watch_enabled": True,     # "Entry for tomorrow" daily watch + alerts
    "watch_eod_time": "16:00", # send the watchlist to Telegram (IST)
    "watch_open_time": "09:08",# morning gap check (falls back to 09:15)
}
_CFG_KEY = "gap_reversal_config"

_status: dict = {}
_result: dict = {"rows": [], "at": None, "params": {}, "counts": {}}


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
async def get_config() -> dict:
    async with aiosqlite.connect(_get_db_path()) as db:
        async with db.execute("SELECT value FROM config WHERE key=?", [_CFG_KEY]) as cur:
            row = await cur.fetchone()
    cfg = dict(DEFAULT_CFG)
    if row and row[0]:
        try:
            cfg.update({k: v for k, v in json.loads(row[0]).items() if k in DEFAULT_CFG})
        except Exception:
            pass
    return cfg


async def save_config(patch: dict) -> dict:
    cfg = await get_config()
    for k, v in patch.items():
        if k in DEFAULT_CFG and v is not None:
            cfg[k] = v
    async with aiosqlite.connect(_get_db_path()) as db:
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [_CFG_KEY, json.dumps(cfg)],
        )
        await db.commit()
    return cfg


def get_status() -> dict:
    return dict(_status)


def get_result() -> dict:
    return dict(_result)


# ---------------------------------------------------------------------------
# Data + indicators
# ---------------------------------------------------------------------------
def _load(con, sym: str, timeframe: str) -> pd.DataFrame:
    rows = con.execute(
        "SELECT date, open, high, low, close, volume FROM candles WHERE symbol=? AND timeframe=? ORDER BY date ASC",
        [sym, timeframe],
    ).fetchall()
    return pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]).set_index("date")


def _rsi_wilder(x: np.ndarray, length: int) -> np.ndarray:
    """Wilder's RSI of a series (matches TradingView's RSI). NaN during warm-up."""
    n = len(x)
    out = np.full(n, np.nan)
    if n < length + 1:
        return out
    delta = np.diff(x)
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = gain[:length].mean()
    avg_loss = loss[:length].mean()
    out[length] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(length + 1, n):
        avg_gain = (avg_gain * (length - 1) + gain[i - 1]) / length
        avg_loss = (avg_loss * (length - 1) + loss[i - 1]) / length
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def compute(df: pd.DataFrame, cfg: dict) -> dict:
    """Arrays for open/high/low/close + ema, rsi_on_ema, rsi_ma, gap%."""
    o = df["open"].astype(float).to_numpy()
    h = df["high"].astype(float).to_numpy()
    lo = df["low"].astype(float).to_numpy()
    c = df["close"].astype(float).to_numpy()
    ema = df["close"].astype(float).ewm(span=int(cfg["ema_length"]), adjust=False).mean().to_numpy()
    rsi = _rsi_wilder(ema, int(cfg["rsi_length"]))
    rsi_ma = pd.Series(rsi).rolling(int(cfg["rsi_ma_length"])).mean().to_numpy()
    gap = np.full(len(c), np.nan)
    gap[1:] = (o[1:] - c[:-1]) / np.where(c[:-1] == 0, np.nan, c[:-1]) * 100.0
    return {"o": o, "h": h, "l": lo, "c": c, "ema": ema, "rsi": rsi, "rsi_ma": rsi_ma, "gap": gap,
            "dates": [str(x) for x in df.index]}


def signal_at(a: dict, i: int, cfg: dict) -> str | None:
    """'BULL' / 'BEAR' / None for a signal whose gap bar is index i.
    RSI-zone is read at i-1 (state going INTO the gap), gap at i."""
    if i < 1:
        return None
    rz = a["rsi"][i - 1]
    g = a["gap"][i]
    if np.isnan(rz) or np.isnan(g):
        return None
    d = cfg.get("direction", "both")
    if d in ("both", "bull") and rz <= cfg["band_lower"] and g >= cfg["gap_pct"]:
        return "BULL"
    if d in ("both", "bear") and rz >= cfg["band_upper"] and g <= -cfg["gap_pct"]:
        return "BEAR"
    return None


def _setup_from_signal(a: dict, i: int, direction: str, cfg: dict, entry: float | None) -> dict:
    """Entry/stop/targets for a signal at gap-bar i. `entry` = next open when known,
    else the signal-bar close as a proxy."""
    ent = float(entry) if entry is not None else float(a["c"][i])
    if direction == "BULL":
        stop = float(a["l"][i])
        risk = ent - stop
    else:
        stop = float(a["h"][i])
        risk = stop - ent
    targets = {}
    for k in cfg["rr_targets"]:
        targets[str(k)] = round(ent + k * risk if direction == "BULL" else ent - k * risk, 2)
    return {
        "signal": direction,
        "gap_date": a["dates"][i][:10],
        "gap_pct": round(float(a["gap"][i]), 2),
        "rsi_ema": round(float(a["rsi"][i - 1]), 2),
        "entry": round(ent, 2),
        "stop": round(stop, 2),
        "risk": round(risk, 2),
        "risk_pct": round(risk / ent * 100, 2) if ent else None,
        "targets": targets,
        "close": round(float(a["c"][i]), 2),
        "ema": round(float(a["ema"][i]), 2),
    }


# ---------------------------------------------------------------------------
# Current-setup scan (signal on the latest completed bar → enter next session)
# ---------------------------------------------------------------------------
def _scan_sync(stocks, cfg, status) -> dict:
    con = sqlite3.connect(_get_db_path())
    tf = cfg["timeframe"]
    min_bars = int(cfg["ema_length"]) + int(cfg["rsi_length"]) + 5
    matches: list[dict] = []
    total = len(stocks)
    for i, sym in enumerate(stocks):
        name = sym.replace("NSE:", "").replace("-EQ", "")
        status.update({"current": name, "done": i, "pending": total - i, "total": total, "step": f"{name} ({i + 1}/{total})"})
        try:
            df = _load(con, sym, tf)
            if len(df) < min_bars:
                continue
            a = compute(df, cfg)
            last = len(a["c"]) - 1
            direction = signal_at(a, last, cfg)
            if direction:
                row = _setup_from_signal(a, last, direction, cfg, entry=None)  # next open unknown → close proxy
                row["symbol"] = name   # short display name (chart endpoint re-qualifies)
                row["entry_note"] = "≈ next open"
                matches.append(row)
        except Exception:
            continue
    con.close()
    matches.sort(key=lambda r: r["gap_date"], reverse=True)
    return {
        "matches": matches,
        "bull": sum(1 for m in matches if m["signal"] == "BULL"),
        "bear": sum(1 for m in matches if m["signal"] == "BEAR"),
        "scanned": total,
    }


async def run_scan(cfg: dict | None = None) -> dict:
    global _status, _result
    cfg = cfg or await get_config()
    _status = {"status": "running", "step": "Resolving universe…", "universe": cfg["universe"]}
    try:
        stocks = await get_universe_stocks(cfg["universe"])
        _status.update({"step": f"Scanning {len(stocks)} stocks…", "total": len(stocks)})
        res = await asyncio.to_thread(_scan_sync, stocks, cfg, _status)
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _result = {"rows": res["matches"], "at": at, "params": dict(cfg),
                   "counts": {"bull": res["bull"], "bear": res["bear"], "scanned": res["scanned"]}}
        _status = {"status": "completed", "at": at, **_result["counts"], "matches": len(res["matches"])}
        return _status
    except Exception as exc:
        _status = {"status": "failed", "message": str(exc)}
        raise


# ---------------------------------------------------------------------------
# Chart data (candles + EMA line + RSI subpanel + band lines + signal markers)
# ---------------------------------------------------------------------------
def _chart_sync(symbol: str, cfg: dict) -> dict:
    # Rows display the short name (ADANIENSOL); the candles table keys are NSE:…-EQ.
    sym = symbol if ":" in symbol else f"NSE:{symbol.strip().upper()}-EQ"
    con = sqlite3.connect(_get_db_path())
    df = _load(con, sym, cfg["timeframe"])
    con.close()
    if df.empty:
        return {"candles": [], "shapes": [], "rsi": [], "focus_date": None}
    a = compute(df, cfg)
    dates = a["dates"]
    candles = [{"date": str(idx), "open": r.open, "high": r.high, "low": r.low, "close": r.close, "volume": r.volume}
               for idx, r in df.iterrows()]
    ema_start = int(cfg["ema_length"])
    ema_pts = [{"date": dates[k], "price": round(float(a["ema"][k]), 2)} for k in range(ema_start, len(df)) if not np.isnan(a["ema"][k])]
    shapes: list[dict] = [{"type": "polyline", "color": "#2563eb", "label": f"EMA {cfg['ema_length']}", "points": ema_pts}]
    rsi_pts = [{"date": dates[k], "rsi": None if np.isnan(a["rsi"][k]) else round(float(a["rsi"][k]), 2),
                "rsi_ma": None if np.isnan(a["rsi_ma"][k]) else round(float(a["rsi_ma"][k]), 2)} for k in range(len(df))]
    # Mark signals on the price panel.
    focus = dates[-1][:10]
    for i in range(1, len(df)):
        d = signal_at(a, i, cfg)
        if d:
            focus = dates[i][:10]
            shapes.append({"type": "marker", "date": dates[i],
                           "price": float(a["l"][i]) if d == "BULL" else float(a["h"][i]),
                           "color": "#22c55e" if d == "BULL" else "#ef4444",
                           "position": "belowBar" if d == "BULL" else "aboveBar",
                           "text": "L" if d == "BULL" else "S"})
    return {"candles": candles, "shapes": shapes, "rsi": rsi_pts,
            "bands": {"upper": cfg["band_upper"], "middle": cfg["band_middle"], "lower": cfg["band_lower"]},
            "focus_date": focus}


async def chart_data(symbol: str, cfg: dict | None = None) -> dict:
    cfg = cfg or await get_config()
    return await asyncio.to_thread(_chart_sync, symbol, cfg)
