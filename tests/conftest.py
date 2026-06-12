import os
import pytest
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.fixture
async def tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setenv("DB_PATH", db_path)
    from backend.db import init_db
    await init_db()
    return db_path

@pytest.fixture
async def app(tmp_db):
    from backend.auth import router as auth_router
    from backend.routers.candles import router as candles_router
    from backend.routers.scans import router as scans_router
    from backend.routers.config import router as config_router
    from backend.routers.sync import router as sync_router

    test_app = FastAPI()
    test_app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    test_app.include_router(auth_router)
    test_app.include_router(candles_router)
    test_app.include_router(scans_router)
    test_app.include_router(config_router)
    test_app.include_router(sync_router)
    return test_app

@pytest.fixture
async def auth_headers(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/login", json={"username": "raja", "password": "raja"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}
