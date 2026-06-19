# 📈 Trade Dashboard

A self-hosted **Indian-market analysis & trading dashboard** — live charts, technical-pattern scanners, an intraday strategy backtester, and a trade journal with **live P&L**, plus Telegram alerts. Runs entirely on your own machine (FastAPI + Next.js).

> Personal project for research and journaling. **Not investment advice.** Backtests are historical and don't guarantee future results.

---

## What it does

| Page | What it gives you |
|---|---|
| **Overview** | At-a-glance dashboard landing. |
| **Live Charts** | Multi-pane real-time candles (NSE stocks, US stocks, crypto). 20+ indicators, per-pane **fullscreen**, **volume on by default**, symbol search. |
| **Charts / Analytics / Weekly / Monthly / Daily** | Deeper single-symbol and aggregate analysis views. |
| **Patterns** | Multi-timeframe **chart-pattern scanner** — Morning/Evening Star, Flag/Pennant, Cup & Handle, Ascending/Descending/Symmetrical Triangle. Trend-aligned detection, **configurable min duration (3 / 6 / 12 months)**, **universe selector**, backtested **entry / stop / target + outcome** (success / failure / open / no-trade) with win-rate, full-history chart (defaults to ~1 year, scroll for more), and **send-to-Telegram** with a rendered chart. |
| **VCP Scanner** | Minervini **Volatility Contraction Pattern** behind the full **8-point Trend Template** gate. Shows the contraction footprint (e.g. `40W 31/3 4T`), volume dry-up, T-count, and the pivot breakout. Universe + duration selectors; Telegram push. |
| **Daily Patterns** | **Tight-range + volume-compression** squeeze scanner over a chosen universe, tagged **Accumulation / Distribution**. Dated scan reports, indicators + fullscreen chart, and optional **AI commentary**. |
| **Backtest** | **Intraday 5-minute strategy backtester** — Opening-Range Breakout, CPR/Pivot, VWAP, Tight-range breakout. Reports **win% / expectancy / net P&L / max-drawdown / equity curve** with realistic costs and end-of-day square-off. |
| **Trades & P&L** | Log **equity / futures / options** trades. Live current price comes from the **real contract** (per expiry) via Fyers, and lot sizes from the **live NSE F&O master**, so P&L is accurate. Realized + unrealized P&L, sortable columns, Telegram. |
| **Holidays / Health / Settings** | NSE holiday calendar; service & data health; settings for the **Broker (Fyers) connection**, Telegram, email, and stock lists. |

### Indicators (Live Charts + pattern detail charts)
SMA · EMA · Bollinger Bands · Supertrend · Ichimoku · Pivot Points · **CPR (Central Pivot Range)** · Fair Value Gaps · Volume Profile · Volume · RSI · MACD · Stochastic · ATR · ADX · CCI · OBV · MFI · Williams %R.

### Stock universes (scanners)
F&O · NIFTY 50 · NIFTY 100 · NIFTY 500 · NIFTY Midcap — resolved live from NSE index lists.

---

## Data sources

- **yfinance** (free, no auth) — 5 yrs of daily, ~60 days of intraday OHLCV.
- **Fyers API** — live quotes, **deep intraday history (1–2 yrs of 5-minute)**, real **F&O contract prices** and authoritative **lot sizes** (F&O instrument master).
  - Fyers disabled the refresh-token API (SEBI), so a fresh token is minted by a **daily TOTP auto-login** (scheduled 8:15 AM). The header shows a **token-status badge** with a live expiry countdown.
- **Telegram** — manual + automatic alerts, with chart images.

---

## Strategy reference
`docs/strategies/` contains methodology notes distilled from Mark Minervini's **Trade Like a Stock Market Wizard** and **Think & Trade Like a Champion** — the Trend Template, VCP, and risk/position-sizing rules the scanners are built on.

---

## Tech stack
- **Backend:** FastAPI · SQLite (aiosqlite) · pandas · yfinance · fyers-apiv3 · pyotp · mplfinance (Telegram chart render)
- **Frontend:** Next.js 14 (App Router, TypeScript) · Tailwind CSS · lightweight-charts v5 · lucide-react

```
backend/    FastAPI app — routers/, scanners/, strategies/, downloaders/, services
frontend/   Next.js app — app/dashboard/* pages, components/, lib/
scripts/    run + deploy + Fyers auto-login (PowerShell, Windows)
docs/       strategy reference
data/        local caches (gitignored)
```

---

## Setup

**Prerequisites:** Python 3.11+, Node 18+.

**Backend**
```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
# create .env (see below), then:
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev                        # http://localhost:3000
```

Open **http://localhost:3000**, log in with `raja` / `raja` (dev default — override with `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

### Environment (`.env`, gitignored — never commit)
```ini
# App auth
JWT_SECRET=<random 48+ char string>     # stable, so sessions survive restarts
JWT_EXPIRE_HOURS=24
ADMIN_USERNAME=raja
ADMIN_PASSWORD=<your password>

# Fyers (for live quotes / F&O prices / deep intraday)
CLIENT_APP_ID=...
APP_SECRET=...
REDIRECT_URI=...
FYERS_ID=...                            # client id
FYERS_TOTP_SECRET=...                   # authenticator secret (enables daily auto-login)
FYERS_PIN=...

# Optional
OPENAI_API_KEY=...                      # Daily Patterns AI commentary
```
Telegram is configured in-app (**Settings → Telegram**) and stored in the DB.

---

## Self-hosting (Windows, always-on)
- `scripts\install-autostart.ps1` — registers auto-restarting Task Scheduler jobs for backend + frontend.
- `scripts\rebuild-frontend.ps1` / `scripts\restart-backend.ps1` — deploy after code changes (rebuild + bounce, clearing any orphaned port).
- `scripts\install-fyers-login.ps1` — schedules the **daily 8:15 AM Fyers auto-login**.
- Remote access via **Cloudflare Tunnel** → see [`SELF-HOST.md`](SELF-HOST.md).
- Cloud deploy artifacts (Fly.io backend / Vercel frontend) → see [`DEPLOY.md`](DEPLOY.md).

---

## Security
This repo is public — **secrets live only in `.env`** (gitignored), along with `*.db` and token files. Always set a **stable `JWT_SECRET`**, and in production set real `ADMIN_*` credentials (the `raja/raja` fallback is dev-only).
