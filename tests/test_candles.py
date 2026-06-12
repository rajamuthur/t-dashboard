import pytest
from httpx import AsyncClient, ASGITransport
import aiosqlite, os

async def _seed_candles(db_path: str):
    async with aiosqlite.connect(db_path) as db:
        await db.executemany(
            "INSERT INTO candles (symbol, timeframe, date, open, high, low, close, volume)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("NSE:SBIN-EQ", "week", "2026-01-01", 100, 110, 90, 105, 5000),
                ("NSE:SBIN-EQ", "week", "2026-01-08", 105, 115, 95, 108, 6000),
                ("NSE:INFY-EQ", "week", "2026-01-01",  50,  55,  45,  52, 3000),
            ],
        )
        await db.commit()

@pytest.mark.asyncio
async def test_get_candles_returns_data(tmp_db, app, auth_headers):
    await _seed_candles(tmp_db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/candles?symbol=NSE:SBIN-EQ&timeframe=week", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]["symbol"] == "NSE:SBIN-EQ"

@pytest.mark.asyncio
async def test_get_symbols_lists_distinct(tmp_db, app, auth_headers):
    await _seed_candles(tmp_db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/candles/symbols?timeframe=week", headers=auth_headers)
    assert r.status_code == 200
    assert set(r.json()) == {"NSE:SBIN-EQ", "NSE:INFY-EQ"}
