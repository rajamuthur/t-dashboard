import pytest, json
import aiosqlite
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport

async def _seed_scan(db_path, matched=True):
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            """INSERT INTO scan_results
               (symbol, timeframe, analysis_type, scanned_at, matched, details, candle_date)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            ["NSE:SBIN-EQ", "week", "3candle_reversal",
             datetime.now(timezone.utc).isoformat(),
             1 if matched else 0,
             json.dumps({"stop_loss": 450.0, "entry_close": 480.0}),
             "2026-01-15"],
        )
        await db.commit()

@pytest.mark.asyncio
async def test_get_scans_returns_matched(tmp_db, app, auth_headers):
    await _seed_scan(tmp_db, matched=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/scans?timeframe=week&matched_only=true", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["symbol"] == "NSE:SBIN-EQ"
    assert data[0]["details"]["stop_loss"] == 450.0

@pytest.mark.asyncio
async def test_get_analysis_types(tmp_db, app, auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/scans/types", headers=auth_headers)
    assert r.status_code == 200
    assert "3candle_reversal" in r.json()
