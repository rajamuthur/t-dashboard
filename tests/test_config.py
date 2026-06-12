import pytest
from httpx import AsyncClient, ASGITransport

@pytest.mark.asyncio
async def test_get_config_returns_default(tmp_db, app, auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/config/weekly_stocks", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert "key" in body and "value" in body

@pytest.mark.asyncio
async def test_put_config_persists(tmp_db, app, auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.put("/config/weekly_stocks",
                    json={"value": ["NSE:SBIN-EQ", "NSE:INFY-EQ"]},
                    headers=auth_headers)
        r = await c.get("/config/weekly_stocks", headers=auth_headers)
    assert r.json()["value"] == ["NSE:SBIN-EQ", "NSE:INFY-EQ"]
