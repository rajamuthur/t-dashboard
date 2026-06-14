"""
Multi-timeframe pattern scan pipeline (Phase 1).

Runs a registered pattern scanner over ALL historical occurrences
(scan_history), de-overlaps near-duplicate detections, evaluates a forward
target/stop outcome per occurrence, and stores results in scan_results.

Self-contained so it doesn't disturb the existing tight_range daily flow
(daily_scan_service). Reuses the scan_results + daily_scan_sessions tables.
"""
import asyncio
import html
import json
import logging
from datetime import date, datetime, timedelta, timezone

import aiosqlite
import pandas as pd

from .db import _get_db_path
from .universe_service import get_universe_stocks
from .scanners.registry import get_scanner, PATTERN_ANALYSIS_TYPES
from .telegram_service import get_telegram_config, send_message

logger = logging.getLogger(__name__)
_status: dict = {}

_AUTO_SEND_CAP = 30          # never push more than this in one auto-alert
_PATTERN_LABELS = {
    "morning_star": "Morning Star",
    "evening_star": "Evening Star",
    "flag_pennant": "Flag / Pennant",
    "cup_handle": "Cup & Handle",
    "ascending_triangle": "Ascending Triangle",
    "descending_triangle": "Descending Triangle",
    "symmetrical_triangle": "Symmetrical Triangle",
    "vcp": "VCP (Minervini)",
}


def get_pattern_scan_status() -> dict:
    return dict(_status)


# ---------------------------------------------------------------------------
# Outcome evaluation — walk candles AFTER the signal until target or stop hits.
# ---------------------------------------------------------------------------
BREAKOUT_WINDOW = 15   # candles allowed for a flag/pennant breakout to trigger


def _evaluate_outcome(direction: str, entry: float, stop: float, target: float,
                      forward: pd.DataFrame, entry_mode: str = "immediate",
                      breakout_level: float | None = None) -> dict:
    """Return {outcome, outcome_price, outcome_date, pnl_pct, entry_fill}.

    outcome:
      'success'  — target hit
      'failure'  — stop hit
      'open'     — entered but neither hit yet
      'no_trade' — breakout-mode pattern that never broke out within the window
    """
    bullish = direction == "bullish"

    # Breakout entry: only "enter" once price closes beyond the channel in the
    # pole direction. Patterns that never break out are non-events ('no_trade').
    if entry_mode == "breakout" and breakout_level is not None:
        trigger_idx = None
        entry_fill = None
        scan = forward.iloc[:BREAKOUT_WINDOW]
        for i, (_dt, row) in enumerate(scan.iterrows()):
            c = float(row["close"])
            if (bullish and c > breakout_level) or ((not bullish) and c < breakout_level):
                trigger_idx = i
                entry_fill = c
                break
        if trigger_idx is None:
            return {"outcome": "no_trade", "outcome_price": None, "outcome_date": None,
                    "pnl_pct": 0.0, "entry_fill": None}
        entry = entry_fill
        eval_fwd = forward.iloc[trigger_idx + 1:]
    else:
        entry_fill = entry
        eval_fwd = forward

    for dt, row in eval_fwd.iterrows():
        hi, lo = float(row["high"]), float(row["low"])
        if bullish:
            if lo <= stop:
                return _result("failure", stop, dt, entry, stop, bullish, entry_fill)
            if hi >= target:
                return _result("success", target, dt, entry, target, bullish, entry_fill)
        else:
            if hi >= stop:
                return _result("failure", stop, dt, entry, stop, bullish, entry_fill)
            if lo <= target:
                return _result("success", target, dt, entry, target, bullish, entry_fill)
    if len(eval_fwd):
        last_close = float(eval_fwd["close"].iloc[-1])
        return _result("open", last_close, eval_fwd.index[-1], entry, last_close, bullish, entry_fill)
    return {"outcome": "open", "outcome_price": None, "outcome_date": None,
            "pnl_pct": 0.0, "entry_fill": entry_fill}


def _result(outcome, exit_price, dt, entry, ref, bullish, entry_fill) -> dict:
    pct = (ref - entry) / entry * 100 if entry else 0.0
    if not bullish:
        pct = -pct
    return {
        "outcome": outcome,
        "outcome_price": round(float(exit_price), 2),
        "outcome_date": str(dt)[:10],
        "pnl_pct": round(float(pct), 2),
        "entry_fill": round(float(entry_fill), 2) if entry_fill is not None else None,
    }


def _dedup_overlaps(occurrences, date_to_pos: dict, min_gap: int):
    """Keep occurrences spaced at least min_gap candles apart (latest-wins per cluster)."""
    kept = []
    last_pos = None
    for occ in sorted(occurrences, key=lambda r: r.candle_date or ""):
        pos = date_to_pos.get(occ.candle_date)
        if pos is None:
            continue
        if last_pos is None or (pos - last_pos) >= min_gap:
            kept.append(occ)
            last_pos = pos
    return kept


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
async def run_pattern_scan(analysis_type: str, timeframe: str = "day", universe: str = "fo") -> dict:
    global _status
    if analysis_type not in PATTERN_ANALYSIS_TYPES:
        raise ValueError(f"Not a pattern scanner: {analysis_type!r}")

    db_path = _get_db_path()
    started_at = datetime.now(timezone.utc).isoformat()
    scan_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    _status = {"status": "running", "step": "Starting...", "matched": 0, "total": 0,
               "analysis_type": analysis_type, "timeframe": timeframe, "universe": universe}

    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute(
            "INSERT INTO daily_scan_sessions (analysis_type, scan_date, started_at, status, timeframe)"
            " VALUES (?, ?, ?, 'running', ?)",
            [analysis_type, scan_date, started_at, timeframe],
        )
        session_id = cur.lastrowid
        await db.commit()

    try:
        stocks = await get_universe_stocks(universe)
        _status.update({"step": f"Scanning {len(stocks)} stocks ({timeframe}, {universe})...", "total": len(stocks)})
        async with aiosqlite.connect(db_path) as db:
            await db.execute("UPDATE daily_scan_sessions SET total_stocks=? WHERE id=?",
                             [len(stocks), session_id])
            await db.commit()

        # Daily: top up recent candles. Intraday: fetch the available yfinance window.
        # Weekly/monthly: read existing candles as-is.
        if timeframe == "day":
            await _sync_recent_daily(stocks, db_path)
        elif timeframe in ("5m", "15m", "30m", "1h", "4h"):
            from .daily_backfill import backfill_timeframe
            _status["step"] = f"Fetching {timeframe} candles (yfinance)..."
            await asyncio.to_thread(backfill_timeframe, db_path, stocks, timeframe, _status)

        scanner = get_scanner(analysis_type)
        matched, inserted = await _scan_all(scanner, stocks, analysis_type, timeframe, session_id, db_path)

        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "UPDATE daily_scan_sessions SET status='completed', finished_at=?, matched_count=? WHERE id=?",
                [datetime.now(timezone.utc).isoformat(), matched, session_id])
            await db.commit()

        # Auto-push only freshly-formed, newly-inserted patterns (never the whole backfill).
        sent = await _maybe_autosend(inserted, analysis_type, timeframe)

        _status = {"status": "completed", "session_id": session_id, "matched": matched,
                   "total": len(stocks), "analysis_type": analysis_type, "timeframe": timeframe,
                   "telegram_sent": sent}
        return _status
    except Exception as exc:
        err = str(exc)
        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "UPDATE daily_scan_sessions SET status='failed', finished_at=?, message=? WHERE id=?",
                [datetime.now(timezone.utc).isoformat(), err, session_id])
            await db.commit()
        _status = {"status": "failed", "message": err}
        raise


async def _sync_recent_daily(stocks: list[str], db_path: str) -> None:
    """Top up recent daily candles via yfinance (Fyers-independent)."""
    from .daily_backfill import backfill_daily
    _status["step"] = "Topping up daily candles (yfinance)..."
    await asyncio.to_thread(backfill_daily, db_path, stocks, "1mo", _status)


async def _scan_all(scanner, stocks, analysis_type, timeframe, session_id, db_path):
    """Returns (matched_count, inserted_occurrences[])."""
    scanned_at = datetime.now(timezone.utc).isoformat()
    matched = 0
    inserted: list[dict] = []
    min_gap = max(2, scanner.window_size // 2)

    async with aiosqlite.connect(db_path) as db:
        for si, symbol in enumerate(stocks):
            _status["step"] = f"Scanning {symbol} ({si + 1}/{len(stocks)})"
            async with db.execute(
                "SELECT date, open, high, low, close, volume FROM candles"
                " WHERE symbol=? AND timeframe=? ORDER BY date ASC",
                [symbol, timeframe],
            ) as cur:
                rows = await cur.fetchall()
            if len(rows) < scanner.window_size:
                continue

            df = pd.DataFrame(list(rows),
                              columns=["date", "open", "high", "low", "close", "volume"]).set_index("date")
            date_to_pos = {str(d): i for i, d in enumerate(df.index)}

            occurrences = await asyncio.to_thread(scanner.scan_history, symbol, timeframe, df)
            occurrences = _dedup_overlaps(occurrences, date_to_pos, min_gap)

            for occ in occurrences:
                det = dict(occ.details or {})
                pos = date_to_pos.get(occ.candle_date)
                forward = df.iloc[pos + 1:] if pos is not None else df.iloc[0:0]
                bl = det.get("breakout_level")
                oc = _evaluate_outcome(
                    det.get("direction", "bullish"),
                    float(det.get("entry_close", 0) or 0),
                    float(det.get("stop_loss", 0) or 0),
                    float(det.get("target", 0) or 0),
                    forward,
                    entry_mode=det.get("entry_mode", "immediate"),
                    breakout_level=float(bl) if bl is not None else None,
                )
                det["pnl_pct"] = oc["pnl_pct"]
                det["entry_fill"] = oc.get("entry_fill")

                async with db.execute(
                    "SELECT id FROM scan_results WHERE symbol=? AND timeframe=? AND analysis_type=? AND candle_date=?",
                    [symbol, timeframe, analysis_type, occ.candle_date],
                ) as cur:
                    existing = await cur.fetchone()
                if existing:
                    await db.execute(
                        "UPDATE scan_results SET details=?, outcome=?, outcome_price=?, outcome_date=?, session_id=? WHERE id=?",
                        [json.dumps(det), oc["outcome"], oc["outcome_price"], oc["outcome_date"], session_id, existing[0]])
                else:
                    await db.execute(
                        """INSERT INTO scan_results
                           (symbol, timeframe, analysis_type, scanned_at, matched, details, candle_date,
                            session_id, outcome, outcome_price, outcome_date)
                           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)""",
                        [symbol, timeframe, analysis_type, scanned_at, json.dumps(det), occ.candle_date,
                         session_id, oc["outcome"], oc["outcome_price"], oc["outcome_date"]])
                    matched += 1
                    inserted.append({
                        "symbol": symbol, "candle_date": occ.candle_date,
                        "direction": det.get("direction"), "subtype": det.get("subtype"),
                        "entry": det.get("entry_close"), "stop": det.get("stop_loss"),
                        "target": det.get("target"),
                    })
        await db.commit()

    _status["matched"] = matched
    return matched, inserted


# ---------------------------------------------------------------------------
# Auto-send freshly-formed patterns to Telegram (Phase 2).
# ---------------------------------------------------------------------------
async def _maybe_autosend(inserted: list[dict], analysis_type: str, timeframe: str) -> int:
    try:
        cfg = await get_telegram_config()
        if not (cfg.get("enabled") and cfg.get("auto_send_patterns")):
            return 0
        if not cfg.get("bot_token") or not cfg.get("chat_id"):
            return 0
        recency = int(cfg.get("auto_send_recency_days", 7) or 7)
        cutoff = (date.today() - timedelta(days=recency)).isoformat()

        fresh = [o for o in inserted if (o.get("candle_date") or "") >= cutoff]
        if not fresh:
            return 0
        fresh.sort(key=lambda o: o["candle_date"], reverse=True)
        capped = fresh[:_AUTO_SEND_CAP]

        label = _PATTERN_LABELS.get(analysis_type, analysis_type)
        lines = [f"\U0001F4D0 <b>New {label}</b> ({timeframe}) — {len(fresh)} just formed", ""]
        for o in capped:
            sym = html.escape((o["symbol"] or "").replace("NSE:", "").replace("-EQ", ""))
            d = o.get("direction") or ""
            emoji = "\U0001F7E2" if d == "bullish" else "\U0001F534"
            sub = f" ({o['subtype'].replace('_', ' ')})" if o.get("subtype") else ""
            lines.append(f"{emoji} <b>{sym}</b>{sub}  <i>{html.escape(o['candle_date'] or '')}</i>")
            bits = []
            if o.get("entry") is not None: bits.append(f"Entry <code>{o['entry']}</code>")
            if o.get("stop") is not None: bits.append(f"SL <code>{o['stop']}</code>")
            if o.get("target") is not None: bits.append(f"Tgt <code>{o['target']}</code>")
            if bits:
                lines.append("  " + " · ".join(bits))
        if len(fresh) > len(capped):
            lines.append(f"\n<i>+{len(fresh) - len(capped)} more (see dashboard)</i>")

        res = await send_message("\n".join(lines))
        if res.get("ok"):
            return len(capped)
        logger.warning("pattern auto-send failed: %s", res.get("error"))
        return 0
    except Exception as exc:  # never let auto-send break the scan
        logger.warning("pattern auto-send error: %s", exc)
        return 0
