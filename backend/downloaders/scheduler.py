"""
APScheduler jobs for periodic data sync and EOW scan.

Jobs:
  weekly_sync   — every Friday 18:00 IST
  monthly_sync  — every last Friday of month 18:30 IST
  eow_scan      — last trading day of week at configurable time (default 15:10 IST)
                  Rescheduled whenever eow_config.scan_time changes.
"""
import asyncio
import json
import logging
from datetime import date

from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


# ---------------------------------------------------------------------------
# Internal job functions
# ---------------------------------------------------------------------------

async def _weekly_job() -> None:
    from ..sync_service import run_sync
    await run_sync("week")


async def _monthly_job() -> None:
    from ..sync_service import run_sync
    await run_sync("month")


async def _fo_verify_job() -> None:
    """Weekly: force-refresh the Fyers F&O master so the F&O stock universe stays
    current (SEBI adds/removes names periodically)."""
    import asyncio
    from ..fyers_fo_master import force_refresh
    try:
        n = await asyncio.to_thread(force_refresh)
        logger.info("F&O list verified: %d stocks", n)
    except Exception:
        logger.exception("F&O verify failed")


async def _alerts_job() -> None:
    """Evaluate chart alerts against live LTP (market-gated inside)."""
    from ..alert_watch import run_alert_check
    try:
        await run_alert_check()
    except Exception:
        logger.exception("alert check failed")


async def _pnl_watch_job() -> None:
    """Evaluate open positions for profit/loss threshold alerts (market-gated inside)."""
    from ..pnl_watch import run_pnl_check
    try:
        await run_pnl_check()
    except Exception:
        logger.exception("pnl watch failed")


async def _pnl_eod_job() -> None:
    """Send the EOD P&L summary if today is a trading day (checked inside)."""
    from ..pnl_watch import run_eod_summary
    try:
        await run_eod_summary()
    except Exception:
        logger.exception("pnl eod summary failed")


async def _pnl_market_open_job() -> None:
    """Send the market-open P&L + index brief (trading-day + enabled checked inside)."""
    from ..pnl_watch import run_market_open_summary
    try:
        await run_market_open_summary()
    except Exception:
        logger.exception("pnl market-open summary failed")


async def _eow_job() -> None:
    """Run EOW scan only if today is the last trading day of the week."""
    from ..routers.holidays import get_holiday_set, get_last_trading_day_of_week
    holidays = await get_holiday_set()
    today    = date.today()
    last_td  = get_last_trading_day_of_week(today, holidays)
    if today != last_td:
        logger.info("EOW job skipped — today (%s) is not last trading day (%s)", today, last_td)
        return
    from ..eow_service import run_eow_scan
    await run_eow_scan("scheduler")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _parse_time(time_str: str) -> tuple[int, int]:
    """Parse 'HH:MM' → (hour, minute). Falls back to (15, 10)."""
    try:
        h, m = time_str.strip().split(":")
        return int(h), int(m)
    except Exception:
        return 15, 10


def start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

    # Regular sync jobs
    _scheduler.add_job(_weekly_job,  "cron", day_of_week="fri",
                       hour=18, minute=0,  id="weekly_sync")
    _scheduler.add_job(_monthly_job, "cron", day_of_week="fri",
                       hour=18, minute=30, id="monthly_sync")

    # EOW job — read configured time, default 15:10
    hour, minute = _get_eow_time_sync()
    _scheduler.add_job(
        _eow_job, "cron",
        day_of_week="mon,tue,wed,thu,fri",  # runs daily, checks inside if last TD
        hour=hour, minute=minute,
        id="eow_scan",
    )
    # Chart-alert watcher — interval (configurable, default 5 min), market-gated.
    _scheduler.add_job(_alerts_job, "interval", minutes=_get_alert_minutes_sync(), id="alerts_watch")

    # Weekly F&O universe verification (Sunday 08:00 IST).
    _scheduler.add_job(_fo_verify_job, "cron", day_of_week="sun", hour=8, minute=0, id="fo_verify")

    # P&L threshold watcher — interval (base check, default 5 min), market-gated.
    pnl_cfg = _get_pnl_cfg_sync()
    _scheduler.add_job(_pnl_watch_job, "interval", minutes=pnl_cfg["base"], id="pnl_watch")
    # EOD P&L summary — daily at configured time (trading-day checked inside).
    _scheduler.add_job(_pnl_eod_job, "cron", day_of_week="mon,tue,wed,thu,fri",
                       hour=pnl_cfg["eod_h"], minute=pnl_cfg["eod_m"], id="pnl_eod")
    # Market-open P&L + index brief (trading-day + enabled checked inside).
    _scheduler.add_job(_pnl_market_open_job, "cron", day_of_week="mon,tue,wed,thu,fri",
                       hour=pnl_cfg["open_h"], minute=pnl_cfg["open_m"], id="pnl_market_open")

    logger.info("Scheduler started. EOW job at %02d:%02d IST · P&L EOD at %02d:%02d IST · open at %02d:%02d IST",
                hour, minute, pnl_cfg["eod_h"], pnl_cfg["eod_m"], pnl_cfg["open_h"], pnl_cfg["open_m"])
    _scheduler.start()


def _get_pnl_cfg_sync() -> dict:
    """Read pnl_alert_config synchronously at startup: base interval + EOD/open times."""
    base, eod, mopen = 5, "16:00", "09:15"
    try:
        import sqlite3
        from ..db import _get_db_path
        con = sqlite3.connect(_get_db_path())
        row = con.execute("SELECT value FROM config WHERE key='pnl_alert_config'").fetchone()
        con.close()
        if row:
            cfg = json.loads(row[0])
            base = max(1, int(cfg.get("base_check_min", 5)))
            eod = str(cfg.get("eod_time", "16:00"))
            mopen = str(cfg.get("market_open_time", "09:15"))
    except Exception:
        pass
    eh, em = _parse_time(eod)
    oh, om = _parse_time(mopen)
    return {"base": base, "eod_h": eh, "eod_m": em, "open_h": oh, "open_m": om}


def reschedule_pnl(base_min: int) -> None:
    """Apply a new P&L base-check interval immediately."""
    if not _scheduler or not _scheduler.running:
        return
    _scheduler.reschedule_job("pnl_watch", trigger="interval", minutes=max(1, int(base_min)))
    logger.info("P&L watcher rescheduled to every %d min", max(1, int(base_min)))


def reschedule_pnl_eod(time_str: str) -> None:
    """Apply a new EOD-summary time immediately."""
    if not _scheduler or not _scheduler.running:
        return
    h, m = _parse_time(time_str)
    _scheduler.reschedule_job("pnl_eod", trigger="cron",
                              day_of_week="mon,tue,wed,thu,fri", hour=h, minute=m)
    logger.info("P&L EOD summary rescheduled to %02d:%02d IST", h, m)


def reschedule_pnl_market_open(time_str: str) -> None:
    """Apply a new market-open-brief time immediately."""
    if not _scheduler or not _scheduler.running:
        return
    h, m = _parse_time(time_str)
    _scheduler.reschedule_job("pnl_market_open", trigger="cron",
                              day_of_week="mon,tue,wed,thu,fri", hour=h, minute=m)
    logger.info("P&L market-open brief rescheduled to %02d:%02d IST", h, m)


def _get_alert_minutes_sync() -> int:
    """Read config.alert_check_minutes synchronously at startup (default 5)."""
    try:
        import sqlite3
        from ..db import _get_db_path
        con = sqlite3.connect(_get_db_path())
        row = con.execute("SELECT value FROM config WHERE key='alert_check_minutes'").fetchone()
        con.close()
        if row:
            return max(1, int(json.loads(row[0])))
    except Exception:
        pass
    return 5


def reschedule_alerts(minutes: int) -> None:
    """Apply a new alert-check interval immediately (called after config update)."""
    if not _scheduler or not _scheduler.running:
        return
    _scheduler.reschedule_job("alerts_watch", trigger="interval", minutes=max(1, int(minutes)))
    logger.info("Alert watcher rescheduled to every %d min", max(1, int(minutes)))


def stop_scheduler() -> None:
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)


def reschedule_eow(time_str: str) -> None:
    """Call this after eow_config.scan_time is updated to apply immediately."""
    if not _scheduler or not _scheduler.running:
        return
    hour, minute = _parse_time(time_str)
    _scheduler.reschedule_job(
        "eow_scan", trigger="cron",
        day_of_week="mon,tue,wed,thu,fri",
        hour=hour, minute=minute,
    )
    logger.info("EOW job rescheduled to %02d:%02d IST", hour, minute)


def _get_eow_time_sync() -> tuple[int, int]:
    """Read eow_config.scan_time synchronously at startup (before event loop)."""
    try:
        import sqlite3, os
        db_path = os.getenv("DB_PATH", "fyers_data.db")
        con = sqlite3.connect(db_path)
        row = con.execute(
            "SELECT value FROM config WHERE key='eow_config'"
        ).fetchone()
        con.close()
        if row:
            cfg = json.loads(row[0])
            return _parse_time(cfg.get("scan_time", "15:10"))
    except Exception:
        pass
    return 15, 10
