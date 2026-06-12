# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack Indian stock market analysis platform using Fyers API v3. Comprises:
- **Backend**: FastAPI + SQLite service for data sync, candlestick pattern scanning, outcome evaluation, and daily pattern analysis with AI
- **Frontend**: Next.js 14 (App Router) dashboard for visualizing signals with interactive charts and AI analysis
- **Live Charts module** (`/dashboard/live-charts`): configurable 1/2/4/6/8-pane TradingView-style dashboard with pluggable data sources (Hyperliquid crypto WS + yfinance India F&O + yfinance US), 17 built-in indicators, per-pane fullscreen, and market-status pills
- **Trades & P&L module** (`/dashboard/trades`): manual trade journal for equity / future / option positions (NIFTY, BANKNIFTY, FINNIFTY, SENSEX, stocks). Auto lot-size resolution, expiry calendar (last-Thursday monthly + weekly Thursdays), live mark-to-market for equity/futures via yfinance, dashboard with realized/unrealized P&L and win-rate.

---

## Directory Structure

```
project-auth/
├── backend/                       # FastAPI application (Python 3.11)
│   ├── main.py                    # FastAPI app factory, CORS, lifespan hooks
│   ├── auth.py                    # JWT auth router (/auth/login, /auth/me)
│   ├── db.py                      # SQLite schema, init_db(), migrate_schema(), get_db()
│   ├── migrate.py                 # One-time parquet -> SQLite importer
│   ├── outcome_service.py         # Lookahead outcome evaluation
│   ├── sync_service.py            # Incremental data sync + scan runner
│   ├── daily_scan_service.py      # Daily pattern scan orchestration (F&O stocks)
│   ├── ai_service.py              # OpenAI gpt-4o-mini news + technical analysis
│   ├── fno_service.py             # Dynamic F&O stock list (NSE → config → env)
│   ├── eow_service.py             # End-of-week alert service
│   ├── notifications.py           # Email / WhatsApp alert delivery
│   ├── data_source.py             # Pluggable Live-Charts data source registry
│   │                              # (YFinanceIndia, YFinanceUS, Hyperliquid)
│   ├── trades_catalog.py          # Trades module: F&O lot sizes + expiry calendar
│   ├── downloaders/
│   │   ├── fyers.py               # FyersDownloader (daily fetch, weekly/monthly resample)
│   │   └── scheduler.py           # APScheduler-based auto-sync jobs
│   ├── routers/
│   │   ├── candles.py             # GET /candles endpoints
│   │   ├── config.py              # GET/PUT /config + F&O refresh
│   │   ├── daily_scans.py         # All /daily-scans endpoints
│   │   ├── scans.py               # All /scans endpoints (weekly/monthly)
│   │   ├── sync.py                # POST /sync/run, GET /sync/status
│   │   ├── eow.py                 # End-of-week scan endpoints
│   │   ├── live_charts.py         # /live-charts/{sources,candles,quote,search}
│   │   ├── trades.py              # /trades CRUD + dashboard + refresh-price + catalog + expiries
│   │   ├── health.py              # Health checks + token management
│   │   └── holidays.py            # NSE market holidays
│   └── scanners/
│       ├── base.py                # BaseScanner ABC + ScanResult dataclass
│       ├── registry.py            # get_scanner(), list_analysis_types(), DAILY_ANALYSIS_TYPES
│       ├── three_candle.py        # 3-candle reversal pattern
│       ├── twin_doji_continuation.py # Twin doji continuation pattern
│       └── tight_range.py         # Tight range breakout (daily, 30-candle window)
│
├── frontend/                      # Next.js 14 App Router (TypeScript + Tailwind CSS 3)
│   ├── app/
│   │   ├── layout.tsx             # Root layout
│   │   ├── page.tsx               # Redirect to /dashboard
│   │   ├── login/page.tsx         # Login page
│   │   └── dashboard/
│   │       ├── layout.tsx         # Sidebar nav (Overview, Analysis accordion, Live Charts, etc.)
│   │       ├── page.tsx           # Dashboard home
│   │       ├── weekly/page.tsx    # <AnalysisPage timeframe="week" />
│   │       ├── monthly/page.tsx   # <AnalysisPage timeframe="month" />
│   │       ├── daily/page.tsx     # Intraday monitor
│   │       ├── daily-patterns/page.tsx  # Daily pattern scans (tight range etc.)
│   │       ├── live-charts/page.tsx     # Live multi-pane charts dashboard
│   │       ├── trades/page.tsx          # Trades & P&L analyzer
│   │       ├── analytics/page.tsx # Analytics dashboard
│   │       ├── charts/page.tsx    # Candlestick chart explorer
│   │       ├── health/page.tsx    # System health + token management
│   │       ├── holidays/page.tsx  # NSE market holidays
│   │       └── settings/page.tsx  # Stock list + schedule config
│   ├── components/
│   │   ├── AnalysisPage.tsx       # Shared weekly/monthly results page
│   │   ├── DailyAnalysisPage.tsx  # Daily patterns page (tight range, future patterns)
│   │   ├── AIAnalysisPanel.tsx    # AI analysis: probabilities, news, reasoning
│   │   ├── PatternChart.tsx       # lightweight-charts v5 candlestick + markers
│   │   ├── LiveChartPane.tsx      # Single live-chart pane (source/symbol/tf + indicators + fullscreen)
│   │   ├── IndicatorsPanel.tsx    # Categorized indicator picker with select-all / per-category bulk
│   │   ├── NewTradeForm.tsx       # Modal form for logging an equity / future / option trade
│   │   ├── OutcomeModal.tsx       # Trade outcome detail modal
│   │   ├── OutcomeBadge.tsx       # Color-coded outcome pill
│   │   ├── CandlestickChart.tsx   # Generic chart component
│   │   ├── StockListEditor.tsx    # Editable stock list for settings
│   │   └── SyncStatus.tsx         # Sync status + trigger button
│   └── lib/
│       ├── api.ts                 # Typed API client (all fetch calls to backend)
│       ├── auth.ts                # JWT token helpers
│       ├── liveSources.ts         # Live-charts typed client + Hyperliquid WS multiplexer
│       ├── indicators.ts          # 17 pure indicator-math functions (SMA/EMA/BB/Ichimoku/...)
│       ├── indicatorCatalog.ts    # Indicator metadata + color palette (used by the picker)
│       ├── marketHours.ts         # NYSE / NSE / Hyperliquid session checks (IANA timezone)
│       └── tradesApi.ts           # Typed client for /trades + dashboard + refresh-price
│
├── tests/                         # Pytest test suite
├── archive/                       # Legacy scripts + parquet data (not used by app)
├── data/                          # Runtime data directory (day/ subfolder for intraday)
├── fyers_data.db                  # SQLite database (auto-created)
├── .env                           # Runtime config (see env vars below)
└── CLAUDE.md                      # This file
```

---

## Setup & Running

### Backend (FastAPI)

```bash
# Activate virtualenv (Python 3.11)
.venv\Scripts\activate    # Windows
source .venv/bin/activate  # Linux/Mac

# Install backend dependencies
pip install fastapi aiosqlite python-jose[cryptography] passlib[bcrypt] \
    uvicorn==0.32.0 pandas fyers-apiv3 python-dotenv apscheduler requests httpx \
    yfinance>=0.2.40

# OR (preferred): use the pinned manifest
pip install -r requirements-backend.txt

# Start backend (port 8000)
uvicorn backend.main:app --reload --port 8000
```

### Frontend (Next.js 14)

```bash
cd frontend
npm install
npm run dev   # starts on http://localhost:3000
```

---

## Environment Variables (`.env`)

| Variable | Purpose |
|---|---|
| `CLIENT_APP_ID` | Fyers app ID (e.g. `8UVMS4X00V-100`) |
| `APP_SECRET` | Fyers app secret |
| `ACCESS_TOKEN` | Current Fyers JWT access token |
| `REFRESH_TOKEN` | Current Fyers refresh token |
| `FYERS_PIN` | 4-digit Fyers PIN for token refresh |
| `AUTO_CAPTURE_AUTH` | `true` = Playwright browser auto-capture for auth code |
| `REDIRECT_URI` | Fyers OAuth redirect URI |
| `AUTH_CODE_URL` | Fyers generate-authcode URL |
| `VALIDATE_URL` | Fyers validate-authcode URL |
| `VALIDATE_REFRESH_URL` | Fyers validate-refresh-token URL |
| `DATA_DIR` | Root data directory (default: `data`) |
| `DATA_WEEK_DIR` | Weekly parquet folder (default: `data/week`) |
| `DATA_MONTH_DIR` | Monthly parquet folder (default: `data/month`) |
| `START_WEEK_DATE` | Backfill start date for weekly data (e.g. `2023-01-01`) |
| `START_MONTH_DATE` | Backfill start date for monthly data (e.g. `2023-01-01`) |
| `FO_STOCKS` | Comma-separated `NSE:SYMBOL-EQ` list for F&O stocks |
| `DAY_ENTRY_STOCKS` | Comma-separated symbols for intraday monitor |
| `DAY_ENTRY_INTERVAL` | Intraday candle interval in minutes (default: `5`) |
| `DB_PATH` | SQLite path override (default: `fyers_data.db`; set in tests) |
| `OPENAI_API_KEY` | OpenAI API key for AI analysis (gpt-4o-mini) |
| `OPENAI_MODEL` | OpenAI model override (default: `gpt-4o-mini`) |

---

## Database Schema (`db.py`)

```sql
-- OHLCV candles (deduped by symbol+timeframe+date)
CREATE TABLE candles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,     -- 'week' | 'month' | 'day'
    date TEXT NOT NULL,
    open REAL NOT NULL, high REAL NOT NULL,
    low REAL NOT NULL, close REAL NOT NULL,
    volume INTEGER NOT NULL DEFAULT 0,
    UNIQUE(symbol, timeframe, date)
);

-- Pattern scan results (weekly, monthly, and daily patterns)
CREATE TABLE scan_results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT NOT NULL,
    timeframe     TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    scanned_at    TEXT NOT NULL,
    matched       INTEGER NOT NULL DEFAULT 0,
    details       TEXT,           -- JSON blob (pattern-specific fields)
    candle_date   TEXT,           -- signal date
    -- Added via migrate_schema():
    outcome       TEXT,           -- 'success' | 'failure' | 'pending' | 'open'
    outcome_price REAL,
    outcome_date  TEXT,
    session_id    INTEGER         -- FK → daily_scan_sessions.id (daily patterns only)
);

-- Daily scan sessions — one row per manual scan run
CREATE TABLE daily_scan_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_type TEXT NOT NULL,
    scan_date     TEXT NOT NULL,  -- YYYY-MM-DD
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    status        TEXT NOT NULL DEFAULT 'running',
    total_stocks  INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    message       TEXT
);

-- Manually-entered trades for the P&L analyzer
CREATE TABLE trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_type TEXT NOT NULL,                 -- 'equity' | 'future' | 'option'
    underlying      TEXT NOT NULL,                 -- 'NIFTY' | 'BANKNIFTY' | stock symbol (no suffix)
    symbol          TEXT NOT NULL,                 -- human label, e.g. 'NIFTY 29MAY26 CE 25000'
    side            TEXT NOT NULL,                 -- 'buy' | 'sell'
    option_type     TEXT,                          -- 'CE' | 'PE' (NULL for non-option)
    strike          REAL,                          -- option strike (NULL for non-option)
    expiry_date     TEXT,                          -- 'YYYY-MM-DD' (NULL for equity)
    lot_size        INTEGER NOT NULL DEFAULT 1,
    num_lots        INTEGER NOT NULL DEFAULT 1,
    entry_price     REAL NOT NULL,
    entry_at        TEXT NOT NULL,
    exit_price      REAL,
    exit_at         TEXT,
    current_price   REAL,                          -- cached last quote (POST /trades/:id/refresh-price)
    current_at      TEXT,
    status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
    notes           TEXT,
    created_at      TEXT NOT NULL
);

-- AI analysis cache — one row per (symbol, analysis_type, scan_date)
CREATE TABLE ai_analysis (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_result_id      INTEGER,
    symbol              TEXT NOT NULL,
    analysis_type       TEXT NOT NULL,
    scan_date           TEXT NOT NULL,
    news_headlines      TEXT,     -- JSON array of {title, source, published}
    technical_summary   TEXT,
    success_probability REAL,
    failure_probability REAL,
    reasoning           TEXT,     -- full JSON response from OpenAI
    created_at          TEXT NOT NULL,
    UNIQUE(symbol, analysis_type, scan_date)
);

-- Per-timeframe stock lists + schedule config
CREATE TABLE config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL           -- JSON-encoded
);

-- Sync run history
CREATE TABLE sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timeframe   TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL DEFAULT 'running',
    message     TEXT
);
```

`init_db()` runs the DDL and calls `migrate_schema()` (idempotent — safe on every startup).

---

## Scanner System

### `BaseScanner` (`backend/scanners/base.py`)

```python
@dataclass
class ScanResult:
    matched: bool
    details: Optional[dict]   # entry_close, stop_loss, etc.
    candle_date: Optional[str]

class BaseScanner(ABC):
    analysis_type: str

    def run(self, symbol, timeframe, df) -> ScanResult:
        """Check the last 3 candles only — used for live/current signal."""

    def scan_history(self, symbol, timeframe, df) -> List[ScanResult]:
        """Slide a 3-candle window over the entire DataFrame.
        Returns every historical match, not just the latest."""
        results = []
        for i in range(2, len(df)):
            window = df.iloc[i - 2 : i + 1]
            result = self.run(symbol, timeframe, window)
            if result.matched:
                results.append(result)
        return results
```

**Critical distinction**: `run()` only checks the last 3 candles (live mode). `scan_history()` scans all windows — use this for populating `scan_results` with historical data.

### 3-Candle Reversal Pattern (`three_candle.py`)

| Candle | Condition |
|---|---|
| **C1** | Red (close < open), body > 10% of full range |
| **C2** | Red (close < open), lower wick ≤ 15% of full range |
| **C3** | Green (close > open), low ≥ C2 low, body ≤ 30% of full range |

- **Entry price** = C3 close (`entry_close`)
- **Stop loss** = C2 low (`stop_loss`)
- **Signal date** = C3 date (`candle_date`)

### Tight Range Scanner (`tight_range.py`)

| Rule | Definition |
|---|---|
| Price band | `(max_high − min_low) / min_low < 10%` across last 30 daily candles |
| Volume drying up | Regression slope negative AND last-5-day avg < 30-day avg |
| RSI(14) | Current daily RSI ≥ 50 |
| No big wicks | < 30% of candles have upper wick ≥ 40% of candle range |

Details stored: `band_pct, vol_ratio, volume_slope, rsi, big_wick_ratio, entry_close, stop_loss, resistance`

### Scanner Registry (`registry.py`)

`get_scanner(analysis_type)` returns the scanner instance.  
`list_analysis_types()` returns all registered type strings.  
`DAILY_ANALYSIS_TYPES` set — scanners that belong under Daily Patterns (not Weekly/Monthly).

---

## Outcome Evaluation (`outcome_service.py`)

Outcome is evaluated by scanning candles **after C3** in chronological order:

1. `low < stop_loss` → **failure** (stop loss hit)
2. `close > entry_close` → **success** (price moved above entry)
3. No subsequent candle with either condition:
   - If the next candle period hasn't closed yet → **pending**
   - If subsequent candles exist but none triggered → **open**

`_period_closed(candle_date, timeframe)` checks:
- **week**: next weekly candle closes on the Friday following `candle_date`
- **month**: next monthly candle closes at end of the month following `candle_date`

Functions:
- `evaluate_outcome(scan_id)` — evaluate and persist outcome for one row
- `evaluate_all_outcomes()` — batch-evaluate all rows where `outcome IS NULL`

---

## API Endpoints

All routes require JWT auth header: `Authorization: Bearer <token>`

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Returns JWT token |
| GET | `/auth/me` | Returns current user |

### Scans (`/scans`)
| Method | Path | Description |
|---|---|---|
| GET | `/scans/types` | List registered analysis types |
| GET | `/scans` | Paginated scan results with filters (see below) |
| GET | `/scans/{id}/detail` | Signal row + C1/C2/C3 + up to 2 subsequent candles |
| POST | `/scans/{id}/fetch-outcome` | Evaluate & persist outcome for one scan |
| POST | `/scans/run` | Run scan for a timeframe (background task) |

**`GET /scans` query parameters:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `timeframe` | string | — | `week` or `month` |
| `analysis_type` | string | — | e.g. `3candle_reversal` |
| `matched_only` | bool | `true` | Filter to matched signals only |
| `outcome` | string | — | `success`, `failure`, `pending`, `open` |
| `symbol_filter` | string | — | SQL LIKE match against symbol |
| `from_date` | string | — | `candle_date >=` |
| `to_date` | string | — | `candle_date <=` |
| `sort_by` | string | `candle_date` | One of: `candle_date`, `symbol`, `outcome`, `scanned_at` |
| `sort_dir` | string | `desc` | `asc` or `desc` |
| `limit` | int | 25 | Max 200 |
| `offset` | int | 0 | For pagination |

Response includes `X-Total-Count` header (total rows matching filters, before pagination).

**`GET /scans/{id}/detail` response:**
```json
{
  "signal": { "id": 1, "symbol": "NSE:SBIN-EQ", "candle_date": "2024-03-08", "outcome": "success", ... },
  "candles": [
    { "date": "2024-02-23", "open": 700, "high": 720, "low": 695, "close": 705, "volume": 1000000 },
    // C1, C2, C3, then up to 2 subsequent candles
  ],
  "pattern_length": 3
}
```

### Daily Scans (`/daily-scans`)
| Method | Path | Description |
|---|---|---|
| POST | `/daily-scans/run` | Fetch F&O list → sync daily candles → run scanner |
| GET | `/daily-scans/status` | In-memory status of the running scan |
| GET | `/daily-scans/sessions` | Past scan session history |
| GET | `/daily-scans/sessions/{id}` | Session detail with matched stocks |
| GET | `/daily-scans` | Paginated results (filters: session_id, symbol, date range) |
| GET | `/daily-scans/{id}/detail` | 40 daily candles + signal for chart |
| POST | `/daily-scans/{id}/ai-analysis` | Get or generate AI analysis (cached by scan_date) |

### Sync (`/sync`)
| Method | Path | Description |
|---|---|---|
| POST | `/sync/run` | Trigger incremental sync + scan for timeframe |
| GET | `/sync/status` | Current sync status (all or by timeframe) |

### Candles (`/candles`)
| Method | Path | Description |
|---|---|---|
| GET | `/candles` | Query OHLCV data for symbol + timeframe |

### Config (`/config`)
| Method | Path | Description |
|---|---|---|
| GET | `/config/{key}` | Read config value |
| PUT | `/config/{key}` | Update config value |

### Live Charts (`/live-charts`)
All routes require JWT auth. Frontend hits these through the `/api/backend/*` Next.js rewrite.

| Method | Path | Description |
|---|---|---|
| GET | `/live-charts/sources` | List registered data sources with their default symbols + supported timeframes |
| GET | `/live-charts/candles?source=&symbol=&timeframe=&limit=` | Historical OHLCV (`limit` ≤ 2000) |
| GET | `/live-charts/quote?source=&symbol=` | Latest price snapshot (used by the yfinance poll loop) |
| GET | `/live-charts/search?source=&q=&limit=` | Symbol autocomplete, region-filtered (`limit` ≤ 250) |

**`GET /live-charts/sources` response:**
```json
[
  { "name": "yfinance",     "label": "yfinance (India)",   "timeframes": ["1m","5m",...,"1mo"], "default_symbols": [...] },
  { "name": "yfinance_us",  "label": "yfinance (US)",      "timeframes": [...],                 "default_symbols": [...] },
  { "name": "hyperliquid",  "label": "Hyperliquid (crypto)","timeframes": [...],                "default_symbols": [...] }
]
```

**Candle/Quote shape:** `{ time: <unix-seconds>, open, high, low, close, volume }` / `{ time, price }`.

### Trades (`/trades`)
All routes require JWT auth.

| Method | Path | Description |
|---|---|---|
| GET    | `/trades` | List trades (filters: `status=open\|closed`, `instrument_type=equity\|future\|option`, `limit≤1000`). Each row carries `pnl`, `pnl_pct`, `ref_price`, `qty` computed server-side. |
| POST   | `/trades` | Create. Body: `instrument_type, underlying, side, num_lots, entry_price` + (`option_type, strike, expiry_date` for options; `expiry_date` for futures). `lot_size` auto-filled from catalog if omitted. |
| PATCH  | `/trades/{id}` | Update — typical use is closing a trade (`{exit_price}`) or refreshing option mark price (`{current_price}`). |
| DELETE | `/trades/{id}` | Remove a trade. |
| GET    | `/trades/catalog` | `{ indices: [...], stocks: [...] }` — used by the form's underlying picker. |
| GET    | `/trades/lot-size?underlying=` | `{ underlying, lot_size }` — `lot_size: null` if unknown. |
| GET    | `/trades/expiries?underlying=` | `{ weekly: [...], monthly: [...] }` — ISO dates; weeklies only for NIFTY/BANKNIFTY/SENSEX. |
| POST   | `/trades/{id}/refresh-price` | Pull current price for one trade (equity / future only). Returns the updated trade. **422** if instrument is option. |
| POST   | `/trades/refresh-all` | Bulk refresh for all open non-option trades. `{ refreshed, skipped }`. |
| GET    | `/trades/dashboard` | Aggregates: `realized_pnl`, `unrealized_pnl`, `total_pnl`, `win_rate`, `wins/losses`, `by_instrument_type`. |

---

## Live Charts Module

A standalone, multi-pane "live dashboard" at `/dashboard/live-charts`. Pluggable data sources, independent per-pane symbol/timeframe/indicators, persisted across reloads.

### Frontend page layout
```
+--------------------------------------------------------------+
| Live Charts | NUMBER OF CHARTS [4 ▾] | ●HL live ●US ●IN ...  |   <- top header
+------------------+-------------------+-----------------------+
|   pane 1 (BTC)   |   pane 2 (RIL.NS) |  ... 2×2 / 3×2 / 4×2  |
+------------------+-------------------+-----------------------+
|   pane 3 (INFY)  |   pane 4 (AAPL)   |                       |
+------------------+-------------------+-----------------------+
```
- **Count selector** (top header): 1 / 2 / 4 / 6 / 8 panes — `grid-cols` flips between `grid-cols-1`, `grid-cols-2`, `grid-cols-3`, `grid-cols-4` with matching `grid-rows`.
- **Market-status pills**: `HL live` (Hyperliquid 24/7), `US market` (NYSE 09:30–16:00 ET, Mon–Fri), `IN market` (NSE 09:15–15:30 IST, Mon–Fri). Re-evaluated every 30s via [`lib/marketHours.ts`](frontend/lib/marketHours.ts).
- **Per pane**: source dropdown · symbol search (debounced, regional) · timeframe selector · INDICATORS button (badge shows count) · fullscreen toggle (HTML5 Fullscreen API on the pane root).

### Per-pane state (persisted in `localStorage`)
```ts
type PaneConfig = { source: string; symbol: string; timeframe: string; indicators?: string[]; };

// keys
"live-charts:count"   // number 1|2|4|6|8
"live-charts:panes"   // JSON array of PaneConfig
"fyers_token"         // JWT, set by login flow
```

The **default recipe** when no stored panes exist is `1 crypto + 2 India + 1 US` then cycle: BTC → RELIANCE.NS → INFY.NS → AAPL → ETH → HDFCBANK.NS → NVDA → TCS.NS (see [`app/dashboard/live-charts/page.tsx`](frontend/app/dashboard/live-charts/page.tsx)). New panes start with `indicators: []` — the user opts in.

### Chart canvas (TradingView look)
- **White background** (`#ffffff`), slate-200 gridlines, slate-700 text, green-600/red-600 candles.
- Top-of-pane **ticker bar** (dark): `SYMBOL · big-price · +Δ (+Δ%) · O · H · L · C · Vol(compact)` — change is computed vs the prior bar's close.
- **Legend overlay** (absolutely positioned top-left of the chart canvas): each enabled indicator shown as a `bg-white/80 border` pill with color swatch + label + hover-revealed `EyeOff` (which calls `toggleIndicator(id)`, i.e. removes it).

### Live data flow
| Source | Historical | Live |
|---|---|---|
| `hyperliquid` | REST `POST /info {type:"candleSnapshot"}` from the backend | **Direct browser WebSocket** `wss://api.hyperliquid.xyz/ws` via singleton multiplexer in [`lib/liveSources.ts`](frontend/lib/liveSources.ts) — subscribes to `candle` channel; auto-reconnect with exponential backoff (1s → 15s cap) |
| `yfinance` (India / US) | `yf.Ticker(symbol).history()` via FastAPI | Polls `/live-charts/quote` every 5s; updates the last bar's `close/high/low` so the candle animates |

### Indicators
17 built-in indicators, all computed in [`lib/indicators.ts`](frontend/lib/indicators.ts) from the candle array (no backend math). Catalog lives in [`lib/indicatorCatalog.ts`](frontend/lib/indicatorCatalog.ts).

| Category | IDs (render as) |
|---|---|
| **TREND** (overlay on price pane) | `sma20`, `ema50`, `bb` (Bollinger 20,2), `supertrend` (10,3), `ichimoku` (Tenkan/Kijun/Senkou A/B/Chikou), `pivots` (PP/R1-3/S1-3 as price-lines) |
| **PRICE ACTION** (overlay on price pane) | `fvg` (Fair Value Gaps as paired price-lines), `vp` (Volume Profile POC/VAH/VAL) |
| **VOLUME** (own sub-pane) | `volume` (color-coded histogram) |
| **OSCILLATORS** (each in its own sub-pane) | `rsi` (14, w/ 30/70 lines), `macd` (12,26,9 + signal + histogram), `stoch` (14,3,3), `atr` (14), `adx` (14 + ±DI), `cci` (20), `obv`, `mfi` (14), `williams` (Williams %R) |

Sub-panes are added via lightweight-charts v5 `chart.addSeries(SeriesType, options, paneIndex)`. The pane index counter is reset on every full refresh so stale empty panes don't accumulate.

#### Indicators panel UX (per pane)
- Categorized checklist matching the catalog above.
- **Header row**: shows `N of M active` with `Select all` / `Clear` bulk buttons.
- **Per category**: `+ / ± / −` glyph toggles that category in bulk.
- Click-outside or `Esc` to close. Selection persisted in `PaneConfig.indicators`.

#### Live-update performance
On every Hyperliquid WS tick (or yfinance poll), `applyCandle`/`applyQuote` mutate `candlesRef.current[last]` and call `scheduleIndicatorRefresh()`, which **throttles to 1Hz** (`refreshTimerRef` + `lastRefreshAtRef`). The refresh wipes & re-creates the active indicator series so the chart stays consistent. **Important**: the refresh reads from `enabledIdsRef`, not the closure-captured `enabledIds`, so toggling indicators while live ticks flow does not "lose" newly added ones.

### Data sources — adding a new broker
Single-file extension point: [`backend/data_source.py`](backend/data_source.py). Decorate a class with `@register("name")` implementing `fetch_candles`, `fetch_quote`, and optionally `search` + `_allowed_symbol`. Example skeleton (Binance):

```python
@register("binance")
class BinanceSource(DataSource):
    label = "Binance"
    timeframes = ["1m", "5m", "15m", "1h", "4h", "1d"]
    default_symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

    async def fetch_candles(self, symbol, timeframe, limit=300): ...
    async def fetch_quote(self, symbol): ...
```

The frontend picks it up automatically from `GET /live-charts/sources`. No frontend changes required for the data path — only if you need a custom **live** transport (WebSocket etc.) does the browser need wiring (see the Hyperliquid singleton in [`lib/liveSources.ts`](frontend/lib/liveSources.ts) as the reference pattern).

### Built-in sources reference
| Source | Universe | Live transport | Notes |
|---|---|---|---|
| `yfinance` | 168 NSE F&O symbols (5 indices + 163 stocks) | poll `/quote` 5s | `search` returns local F&O hits first, then falls back to Yahoo `/v1/finance/search` filtered to `.NS` / `.BO` / `^NSE*` / `^BSE*` / `^CNX*` |
| `yfinance_us` | 69 large-caps + ETFs + indices | poll `/quote` 5s | `search` filtered to Yahoo exchange codes `NMS/NGM/NCM/NYQ/ASE/PCX/BTS/OQB/PNK` and major US indices |
| `hyperliquid` | Pulled lazily from `/info {type:"meta"}` | **browser WS** | REST `/info {type:"allMids"}` is also used as a quote fallback |

---

## Trades & P&L Module

A manually-curated trade journal at `/dashboard/trades` for tracking equity, futures, and options positions with live mark-to-market. **No broker integration** — users log entries by hand; the backend resolves lot sizes and live prices.

### Frontend layout
```
+-----------------------------------------------------------------+
| Trades & P&L                          [↻ Refresh prices] [+ New]|
+-----------------------------------------------------------------+
| [Realized] [Unrealized] [Total P&L] [Win rate]                  |   <- stat cards
| [Equity 1o/0c +2,600] [Future 0o/1c −500] [Option 1o/0c 0]      |
| [open] [closed] [all]                                            |   <- filter tabs
+-----------------------------------------------------------------+
| Symbol | Type | Side | Qty | Entry | Current/Exit | P&L | %    |
| NIFTY 28MAY26 CE 25000 | option | buy | 2×75 | 120.5 | ...      |
+-----------------------------------------------------------------+
```
- Stat cards refresh whenever the trades list refreshes.
- **Auto-refresh** every 30s — calls `POST /trades/refresh-all` then reloads. Options are skipped (premium isn't reliably available from yfinance).
- Closing a trade: `Close` icon → `prompt()` for exit price → `PATCH /trades/{id} {exit_price}` → backend sets `status='closed'`, `exit_at=now`.
- Options: `Pencil` icon opens a `prompt()` for the latest premium → `PATCH /trades/{id} {current_price}`.

### Entry form (`NewTradeForm.tsx`)
- **Instrument**: Equity / Future / Option (default Option).
- **Underlying**: pill row of indices (NIFTY · BANKNIFTY · FINNIFTY · MIDCPNIFTY · NIFTYNEXT50 · SENSEX · BANKEX) + a "Stock" pill that swaps in a searchable input using `searchSymbols('yfinance', q)` from the Live Charts client (so F&O stocks autocomplete).
- **Side**: Buy / Long · Sell / Short (color-coded green/red).
- **Option-only fields**: CE / PE picker + Strike numeric.
- **Expiry**: dropdown populated from `GET /trades/expiries?underlying=...` — groups weeklies and monthlies. Defaults to first monthly.
- **Entry price · Lots · Lot size**: lot size auto-filled from `GET /trades/lot-size`. Live "Total quantity" + "Notional" computed inline.
- **Symbol formatting** (done backend-side): options → `NIFTY 28MAY26 CE 25000`; futures → `NIFTY 28MAY26 FUT`; equity → just the underlying symbol.

### Lot-size & expiry catalog ([`trades_catalog.py`](backend/trades_catalog.py))

**Indices** (with Yahoo proxy symbol used for futures mark-to-market):

| Underlying | Lot | Yahoo | Weeklies |
|---|---|---|---|
| NIFTY | 75 | `^NSEI` | yes |
| BANKNIFTY | 30 | `^NSEBANK` | yes |
| FINNIFTY | 65 | `^CNXFIN` | no |
| MIDCPNIFTY | 75 | `^NSEMDCP50` | no |
| NIFTYNEXT50 | 25 | `^NSMIDCP` | no |
| SENSEX | 20 | `^BSESN` | yes |
| BANKEX | 30 | `^BSEBANK` | no |

**Stocks**: 133 NSE F&O names with hardcoded lot sizes (RELIANCE 500, TCS 175, INFY 400, HDFCBANK 550, etc.). Refresh this list each quarter when NSE publishes revisions.

**Expiry generation**: monthly = last Thursday of the month for the current + next 2 months (skipping today if it's already past). Weekly = next 4 Thursdays for symbols with `weekly=True`. Dates returned as `YYYY-MM-DD` strings.

### Live mark-to-market

`POST /trades/{id}/refresh-price` and `POST /trades/refresh-all` use yfinance to resolve the current price:
- **Equity** → use the stored underlying (already a Yahoo-style symbol if user typed `.NS`, else append `.NS`).
- **Future** → proxy with the index's Yahoo symbol (`underlying_yahoo_symbol()`). The future doesn't track the index 1:1 but it's a usable approximation for live P&L without paid F&O feeds.
- **Option** → not auto-priced. The endpoint returns **422** and the UI offers a `Pencil` action that PATCHes `current_price` manually.

The quote fallback chain is identical to the Live Charts module's yfinance source: `fast_info` attribute access → 1d/1m history → 5d/5m → 1mo/1d.

### P&L formula

```
qty       = lot_size * num_lots
ref_price = exit_price (if closed) else current_price (if available) else entry_price

if side == 'buy':  pnl = (ref_price - entry_price) * qty
if side == 'sell': pnl = (entry_price - ref_price) * qty

pnl_pct   = (ref - entry) / entry * 100   (negated for sell)
```

All four values (`pnl, pnl_pct, ref_price, qty`) are computed on every API response — frontend doesn't recompute. Aggregates in `/trades/dashboard` are produced by summing per-row `pnl` server-side.

### Gotchas
- **Lot sizes drift quarterly** — NSE publishes revisions roughly every 3 months. Lot size in `trades_catalog.py` is editable, and the form lets the user override per-trade (the value is stored on the row, so historical trades keep their original lot size).
- **Option premium isn't free** — yfinance Indian-options coverage is unreliable. Users must update option `current_price` manually. The UI flags `current_price=null` with `—` in the table.
- **Futures live price is a proxy** — futures track the spot ±cost-of-carry. We use spot. For a precise P&L of a future, close the trade with an exit price.
- **Symbols vs underlying**: `underlying` is the human-friendly key (e.g. `NIFTY`, `RELIANCE`); `symbol` is the auto-formatted descriptor. Search the table by `underlying`, display the `symbol`.

---

## Frontend — AnalysisPage Component

`frontend/components/AnalysisPage.tsx` is the shared component for both `/dashboard/weekly` and `/dashboard/monthly`. Features:

- **Filters**: symbol (LIKE), from_date, to_date, outcome (select), pattern type (select)
- **Filter reset**: "Clear filters" button shown when any filter is active
- **Month grouping**: results grouped by `"Month YYYY"` of `candle_date`; each group is collapsible
- **Sortable columns**: Symbol, Signal Date, Outcome — toggles asc/desc; resets to page 0
- **Pagination**: page/pageSize state; page size selector (25/50/100); numbered page buttons
- **Row expansion (accordion)**: clicking a row calls `GET /scans/{id}/detail`, renders `PatternChart` inline
- **PatternChart**: lightweight-charts v5 candlestick chart with:
  - `arrowDown` markers on C1/C2/C3 in red/orange/green
  - Dashed price lines for Entry (green) and Stop Loss (red)
- **Fetch button**: shown when `canFetchOutcome()` is true (period closed + outcome is null). Calls `POST /scans/{id}/fetch-outcome`, then reloads data
- **OutcomeBadge**: color-coded pill — success (green), failure (red), pending (yellow), open (gray)
- Next-candle-not-closed indicator: yellow pulsing dot when no subsequent candles in DB

---

## Data Sync Flow (`sync_service.py`)

1. Read stock list from `config` table (`{timeframe}_stocks` key)
2. For each symbol: fetch from last stored date → today via `FyersDownloader.fetch_daily()`
3. Resample to weekly (W-FRI) or monthly via `FyersDownloader.resample_weekly/monthly()`
4. Upsert into `candles` table (update OHLCV on conflict)
5. Run all registered scanners via `scan_history()` on entire symbol history
6. Insert new `scan_results` (deduplicated by symbol+timeframe+analysis_type+candle_date)
7. Update `sync_log` with status + message

**Fyers API date range limit**: fetch in 180-day chunks when backfilling long histories.

---

## Key Dependencies

### Backend
- `fastapi` 0.115 — web framework
- `uvicorn` 0.32.0 — ASGI server (plain, no standard extras — MSVC not available on Windows)
- `aiosqlite` 0.20 — async SQLite
- `python-jose[cryptography]` — JWT tokens
- `passlib[bcrypt]` — password hashing
- `pandas` / `numpy` — OHLCV resampling, linear regression for volume slope
- `fyers_apiv3` — Fyers broker API client
- `yfinance` ≥0.2.40 — Yahoo Finance data for the Live Charts module (India + US)
- `httpx` 0.27 — async HTTP client (Hyperliquid REST + Yahoo search)
- `apscheduler` 3.10 — scheduled sync jobs
- `python-dotenv` — `.env` loading
- `openai` 2.x — AI analysis via gpt-4o-mini (chat completions + JSON mode)

### Frontend
- `next` 14 — App Router, TypeScript
- `tailwindcss` 3 — utility CSS
- `lightweight-charts` v5 — candlestick + multi-pane charts (`addSeries(Type, opts, paneIndex)`)
- `lucide-react` — icons (Maximize2/Minimize2/EyeOff/LineChart/Radio used by Live Charts)

---

## Notes

- All timestamps are in UTC; display converts to `Asia/Kolkata` (IST). Live Charts uses unix-seconds (`UTCTimestamp`) on the wire.
- Fyers API symbol format: `NSE:SYMBOL-EQ` for equities, `NSE:SYMBOL-INDEX` for indices
- yfinance symbol format: NSE = `SYMBOL.NS`, BSE = `SYMBOL.BO`, US = bare ticker (e.g. `AAPL`), indices use `^` prefix (`^NSEI`, `^GSPC`)
- Hyperliquid symbol format: bare coin name (`BTC`, `ETH`, `SOL`)
- Market hours: NSE 9:15 AM – 3:30 PM IST · NYSE 9:30 AM – 4:00 PM ET · Hyperliquid 24/7
- `DB_PATH` env var overrides the SQLite path — used in tests for isolation
- `scan_history()` must be used for populating historical data; `run()` is only for live current-candle checks
- `migrate_schema()` is idempotent — safe to call on every startup
- CORS is configured for `http://localhost:3000` only; update `main.py` for production
- Daily candles and AI analysis are stored datewise — re-running a scan on the same day skips already-fetched data
- AI analysis is cached by `(symbol, analysis_type, scan_date)` — OpenAI is called at most once per stock per day
- `archive/` folder holds all legacy parquet-based scripts and data — not needed for running the app

### Live Charts gotchas
- **Pluggable sources are auto-discovered** from `_REGISTRY` in `backend/data_source.py`. Adding a `@register("name")` class is the only step needed for the source to appear in the frontend dropdown — no manual wiring.
- **Hyperliquid runs through a direct browser WebSocket** (not via FastAPI). The browser does its own auth-less connection to `wss://api.hyperliquid.xyz/ws`. The backend `hyperliquid` source only seeds historical candles + acts as a quote fallback.
- **yfinance `FastInfo` quirks**: `.get("last_price")` returns `None` because dict-key access uses camelCase (`lastPrice`) — always use attribute access (`fi.last_price`) or iterate the camelCase keys. The quote helper in `data_source.py` does attribute access + multi-period history fallback so off-hours quotes still resolve.
- **Indicator live updates** wipe & re-create series each tick (throttled to 1Hz). Read from `enabledIdsRef.current` inside `refreshAllIndicators` — reading `enabledIds` directly captures a stale set in the load `useEffect` closure and indicators will disappear when toggled mid-stream.
- **Chart panes**: lightweight-charts v5 creates sub-panes on demand when you pass `paneIndex > 0` to `addSeries`. Reset `nextPaneIndexRef.current = 1` before a full redraw so panes don't accumulate.
- **localStorage keys**: `live-charts:count`, `live-charts:panes`, `fyers_token`. Clear `live-charts:panes` to reset to the default 1+2+1 recipe.

### Trades module gotchas
- **No broker integration** — every trade is manually entered. Fix lot sizes / strikes per-trade in the form if the catalog is stale.
- **Options need manual price updates** — `refresh-all` skips options; the table flags them and the pencil-icon action opens a `prompt()` for the latest premium.
- **Auto-refresh cadence**: 30 seconds for open non-option trades. This is intentional — yfinance is rate-limited and the Indian market only ticks 9:15–15:30 IST anyway.
- **Closing a trade is final-ish**: PATCH `{exit_price}` sets `status='closed'` and timestamps `exit_at`. To re-open, PATCH `{status: 'open'}` — it nulls `exit_price` and `exit_at`.
- **Aggregation respects status**: `realized_pnl` sums closed trades only; `unrealized_pnl` sums open trades' live P&L. Open trades whose `current_price` hasn't been fetched yet report P&L=0 (`ref_price` falls back to entry).
