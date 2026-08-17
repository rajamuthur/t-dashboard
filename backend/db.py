import aiosqlite
import json
import os
from dotenv import load_dotenv

load_dotenv()

def _get_db_path() -> str:
    return os.getenv("DB_PATH", "fyers_data.db")

# Module-level attribute kept for backward compatibility and sync_service imports
DB_PATH = _get_db_path()

_DDL = """
CREATE TABLE IF NOT EXISTS candles (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol    TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    date      TEXT NOT NULL,
    open      REAL NOT NULL,
    high      REAL NOT NULL,
    low       REAL NOT NULL,
    close     REAL NOT NULL,
    volume    INTEGER NOT NULL DEFAULT 0,
    UNIQUE(symbol, timeframe, date)
);
CREATE INDEX IF NOT EXISTS idx_candles ON candles(symbol, timeframe);

CREATE TABLE IF NOT EXISTS scan_results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT NOT NULL,
    timeframe     TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    scanned_at    TEXT NOT NULL,
    matched       INTEGER NOT NULL DEFAULT 0,
    details       TEXT,
    candle_date   TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans ON scan_results(timeframe, analysis_type, scanned_at);

CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timeframe   TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL DEFAULT 'running',
    message     TEXT
);

CREATE TABLE IF NOT EXISTS daily_scan_sessions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_type  TEXT NOT NULL,
    scan_date      TEXT NOT NULL,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    status         TEXT NOT NULL DEFAULT 'running',
    total_stocks   INTEGER NOT NULL DEFAULT 0,
    matched_count  INTEGER NOT NULL DEFAULT 0,
    message        TEXT
);
CREATE INDEX IF NOT EXISTS idx_daily_sessions ON daily_scan_sessions(analysis_type, scan_date);

CREATE TABLE IF NOT EXISTS ai_analysis (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_result_id       INTEGER,
    symbol               TEXT NOT NULL,
    analysis_type        TEXT NOT NULL,
    scan_date            TEXT NOT NULL,
    news_headlines       TEXT,
    technical_summary    TEXT,
    success_probability  REAL,
    failure_probability  REAL,
    reasoning            TEXT,
    created_at           TEXT NOT NULL,
    UNIQUE(symbol, analysis_type, scan_date)
);
CREATE INDEX IF NOT EXISTS idx_ai_analysis ON ai_analysis(symbol, analysis_type, scan_date);

-- Manually-entered trade journal for P&L analysis.
CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_type TEXT NOT NULL,                 -- 'equity' | 'future' | 'option'
    underlying      TEXT NOT NULL,                 -- 'NIFTY' | 'BANKNIFTY' | stock symbol w/o suffix
    symbol          TEXT NOT NULL,                 -- human label e.g. 'NIFTY 29MAY26 CE 25000'
    side            TEXT NOT NULL,                 -- 'buy' | 'sell'
    option_type     TEXT,                          -- 'CE' | 'PE' (NULL for non-option)
    strike          REAL,                          -- option strike (NULL for non-option)
    expiry_date     TEXT,                          -- YYYY-MM-DD (NULL for equity)
    lot_size        INTEGER NOT NULL DEFAULT 1,
    num_lots        INTEGER NOT NULL DEFAULT 1,
    entry_price     REAL NOT NULL,
    entry_at        TEXT NOT NULL,
    exit_price      REAL,
    exit_at         TEXT,
    current_price   REAL,                          -- cached last quote (refreshed by /refresh-price)
    current_at      TEXT,
    status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
    notes           TEXT,
    mode            TEXT NOT NULL DEFAULT 'actual', -- 'actual' | 'paper'
    rationale       TEXT,                           -- paper-trade entry thesis ("why I'm entering")
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status, entry_at);
CREATE INDEX IF NOT EXISTS idx_trades_underlying ON trades(underlying);

-- Named watchlists (multiple) + their symbols. Fyers-format symbols
-- (NSE:RELIANCE-EQ, NSE:NIFTY50-INDEX, NSE:SRF26AUGFUT).
CREATE TABLE IF NOT EXISTS watchlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_id  INTEGER NOT NULL,
    symbol        TEXT NOT NULL,
    label         TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    UNIQUE(watchlist_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_wl ON watchlist_items(watchlist_id, sort_order);

-- Price / trendline alerts drawn on a chart. Trend anchors (t1..p2) are unix
-- seconds; horizontal uses `price`. Evaluated against live LTP by a watcher job.
CREATE TABLE IF NOT EXISTS alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol       TEXT NOT NULL,                        -- Fyers symbol (NSE:XXX-EQ / index)
    name         TEXT,
    timeframe    TEXT NOT NULL DEFAULT 'day',          -- chart tf it was drawn on
    kind         TEXT NOT NULL,                        -- 'horizontal' | 'trend'
    condition    TEXT NOT NULL,                        -- 'cross_up' | 'cross_down'
    repeat_mode  TEXT NOT NULL DEFAULT 'once',         -- 'once' | 'recurring'
    price        REAL,                                 -- horizontal level
    t1 INTEGER, p1 REAL, t2 INTEGER, p2 REAL,          -- trend anchors (unix secs)
    note         TEXT,
    status       TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'triggered' | 'disabled'
    last_diff    REAL,                                 -- LTP - line_value at last check (cross detection)
    created_at   TEXT NOT NULL,
    triggered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

-- One row per time an alert fires, with Telegram delivery status.
CREATE TABLE IF NOT EXISTS alert_notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id     INTEGER NOT NULL,
    symbol       TEXT,
    triggered_at TEXT NOT NULL,
    price        REAL,                                 -- LTP at trigger
    line_value   REAL,                                 -- threshold at trigger
    direction    TEXT,                                 -- 'up' | 'down'
    message      TEXT,
    delivered    INTEGER NOT NULL DEFAULT 0,           -- Telegram send succeeded?
    error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_notifs_alert ON alert_notifications(alert_id, id);

-- One row per P&L-alert fire (profit/loss threshold, expiry warning, EOD summary),
-- with Telegram delivery status. Also the source of "last fired at" so recurring
-- profit/loss alerts honour their configured re-fire interval (per trade + kind).
CREATE TABLE IF NOT EXISTS pnl_notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id     INTEGER,                              -- NULL for book-wide (eod) rows
    symbol       TEXT,                                 -- trade label at fire time
    mode         TEXT,                                 -- 'actual' | 'paper'
    kind         TEXT NOT NULL,                        -- 'profit' | 'loss' | 'expiry' | 'eod'
    triggered_at TEXT NOT NULL,
    pnl          REAL,                                 -- ₹ P&L at fire
    pnl_pct      REAL,
    price        REAL,                                 -- current price at fire
    message      TEXT,
    delivered    INTEGER NOT NULL DEFAULT 0,           -- Telegram send succeeded?
    error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pnl_notifs_trade ON pnl_notifications(trade_id, kind, id);
"""

async def migrate_schema() -> None:
    """Add columns introduced after initial schema creation. Idempotent."""
    async with aiosqlite.connect(DB_PATH) as db:
        for table, col, typedef in [
            ("scan_results", "outcome",       "TEXT"),
            ("scan_results", "outcome_price", "REAL"),
            ("scan_results", "outcome_date",  "TEXT"),
            ("scan_results", "is_eow_alert",  "INTEGER NOT NULL DEFAULT 0"),
            ("scan_results", "session_id",    "INTEGER"),
            ("sync_log",     "rows_saved",    "INTEGER NOT NULL DEFAULT 0"),
            ("sync_log",     "stocks_scanned","INTEGER NOT NULL DEFAULT 0"),
            ("sync_log",     "data_from",     "TEXT"),
            ("sync_log",     "data_to",       "TEXT"),
            # Pattern scanner: sessions can be run per timeframe (day/week/month/...).
            ("daily_scan_sessions", "timeframe", "TEXT NOT NULL DEFAULT 'day'"),
            # Paper vs actual trade book. Existing rows default to 'actual'.
            ("trades", "mode",      "TEXT NOT NULL DEFAULT 'actual'"),
            ("trades", "rationale", "TEXT"),
        ]:
            try:
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}")
                await db.commit()
            except Exception:
                pass  # column already exists


async def init_db() -> None:
    db_path = _get_db_path()
    async with aiosqlite.connect(db_path) as db:
        # WAL is a persistent, file-level setting: once enabled it applies to
        # every connection AND every process (backend + the daily-login task),
        # so readers and the writer no longer block each other. This is the fix
        # for the "database is locked" errors under concurrent access. Only
        # writer-vs-writer serialize now, and busy_timeout makes them queue
        # instead of failing instantly.
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA synchronous=NORMAL")
        await db.execute("PRAGMA busy_timeout=15000")
        await db.executescript(_DDL)
        await db.commit()
    await _seed_default_config()
    await _seed_default_watchlist()
    await migrate_schema()


async def _seed_default_watchlist() -> None:
    """On a fresh DB (no watchlists yet), create a default list with the two
    headline indices so the Watchlist page isn't empty on first open."""
    from datetime import datetime, timezone
    db_path = _get_db_path()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    async with aiosqlite.connect(db_path) as db:
        async with db.execute("SELECT COUNT(*) FROM watchlists") as cur:
            (count,) = await cur.fetchone()
        if count:
            return
        cur = await db.execute(
            "INSERT INTO watchlists (name, sort_order, created_at) VALUES ('My Watchlist', 0, ?)",
            [now],
        )
        wl_id = cur.lastrowid
        for i, (sym, label) in enumerate([
            ("NSE:NIFTY50-INDEX", "NIFTY 50"),
            ("NSE:NIFTYBANK-INDEX", "NIFTY BANK"),
        ]):
            await db.execute(
                "INSERT INTO watchlist_items (watchlist_id, symbol, label, sort_order, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                [wl_id, sym, label, i, now],
            )
        await db.commit()

async def _seed_default_config() -> None:
    db_path = _get_db_path()
    fo_raw = os.getenv("FO_STOCKS", "")
    fo_stocks = [s.strip() for s in fo_raw.split(",") if s.strip()]
    day_raw = os.getenv("DAY_ENTRY_STOCKS", "")
    day_stocks = [s.strip() for s in day_raw.split(",") if s.strip()]

    defaults = {
        "weekly_stocks":  fo_stocks,
        "monthly_stocks": fo_stocks,
        "daily_stocks":   day_stocks,
        "day_interval":   os.getenv("DAY_ENTRY_INTERVAL", "5"),
        "sync_schedule": {"weekly": "FRI_18:00", "monthly": "LAST_FRI_18:00"},
        "analysis_params": {
            "3candle_reversal": {
                "c1_body_pct": 0.1,
                "c2_lower_wick_pct": 0.15,
                "c3_body_pct": 0.3,
            },
            "twin_doji_continuation": {
                "c1_require_green":        False,
                "c2_min_body_pct":         60,
                "c3_max_body_pct":         15,
                "c4_max_body_pct":         15,
            },
        },
        "eow_config": {
            "enabled": True,
            "scan_time": "15:10",          # HH:MM IST — configurable
            "notify_email": True,
            "notify_whatsapp": True,
        },
        "email_config": {
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "username": "",
            "password": "",               # Gmail App Password
            "from_name": "Fyers Scanner",
            "to_addresses": [],
        },
        "whatsapp_config": {
            "recipients": [
                {"phone": "9677132280", "apikey": ""}
            ]
        },
        "telegram_config": {
            "enabled": False,
            "bot_token": "",
            "chat_id": "",
            "auto_send_patterns": False,    # auto-push freshly-formed patterns on scan
            "auto_send_recency_days": 7,    # only auto-send patterns formed within N days
        },
        "nse_holidays": [],               # populated by POST /holidays/refresh
        "nse_holidays_updated": "",
        "fo_stocks_updated": "",
    }
    async with aiosqlite.connect(db_path) as db:
        for key, value in defaults.items():
            await db.execute(
                "INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)",
                [key, json.dumps(value)],
            )
        await db.commit()

async def get_db():
    db_path = _get_db_path()
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        # Wait up to 15s for a write lock instead of erroring instantly.
        await db.execute("PRAGMA busy_timeout=15000")
        yield db
