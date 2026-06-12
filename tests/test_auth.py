import pytest
from httpx import AsyncClient, ASGITransport

@pytest.mark.asyncio
async def test_login_returns_token(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/login", json={"username": "raja", "password": "raja"})
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert r.json()["token_type"] == "bearer"

@pytest.mark.asyncio
async def test_login_wrong_password(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/login", json={"username": "raja", "password": "bad"})
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_protected_route_without_token(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/me")
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_me_with_valid_token(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        login_r = await c.post("/login", json={"username": "raja", "password": "raja"})
        token = login_r.json()["access_token"]
        r = await c.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "raja"
