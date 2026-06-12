"""
One-time migration: import existing parquet files into SQLite.

Usage:
    python -m backend.migrate
"""
import asyncio
import glob
import os
import aiosqlite
import pandas as pd
from dotenv import load_dotenv

load_dotenv()


async def migrate_parquet(folder: str, timeframe: str, db: aiosqlite.Connection) -> int:
    pattern = os.path.join(folder, "*.parquet")
    files = glob.glob(pattern)
    total = 0
    for fpath in files:
        basename = os.path.basename(fpath)
        symbol_part = basename.replace("_weekly.parquet", "").replace("_monthly.parquet", "")
        symbol = f"NSE:{symbol_part}-EQ"

        df = pd.read_parquet(fpath)
        # Normalize to lowercase; handle duplicate cols from mixed-case concat
        df.columns = [c.lower() for c in df.columns]
        # If duplicate columns exist (e.g. both 'open' and 'open' after lowercasing
        # Title-case + lowercase cols), keep the first non-NaN value per column
        if df.columns.duplicated().any():
            df = df.loc[:, ~df.columns.duplicated(keep="first")]

        for idx, row in df.iterrows():
            # Skip rows with NaN in OHLC
            if pd.isna(row["open"]) or pd.isna(row["high"]) or pd.isna(row["low"]) or pd.isna(row["close"]):
                continue
            date_str = pd.Timestamp(idx).strftime("%Y-%m-%d")
            vol = row.get("volume", 0)
            await db.execute(
                """INSERT INTO candles (symbol, timeframe, date, open, high, low, close, volume)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(symbol, timeframe, date) DO NOTHING""",
                [symbol, timeframe, date_str,
                 float(row["open"]), float(row["high"]),
                 float(row["low"]),  float(row["close"]),
                 int(vol) if pd.notna(vol) else 0],
            )
            total += 1
    await db.commit()
    return total


async def main():
    from .db import _get_db_path, init_db
    await init_db()
    db_path = _get_db_path()
    async with aiosqlite.connect(db_path) as db:
        week_dir  = os.getenv("DATA_WEEK_DIR",  "data/week")
        month_dir = os.getenv("DATA_MONTH_DIR", "data/month")
        n_week  = await migrate_parquet(week_dir,  "week",  db)
        n_month = await migrate_parquet(month_dir, "month", db)
        print(f"Migrated {n_week} weekly rows, {n_month} monthly rows -> {db_path}")


if __name__ == "__main__":
    asyncio.run(main())
