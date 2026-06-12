import pytest
import aiosqlite
import os

@pytest.mark.asyncio
async def test_init_db_creates_all_tables(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    from backend.db import init_db
    await init_db()
    async with aiosqlite.connect(str(tmp_path / "test.db")) as db:
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table'") as cur:
            tables = {r[0] for r in await cur.fetchall()}
    assert tables >= {"candles", "scan_results", "config", "sync_log"}

@pytest.mark.asyncio
async def test_init_db_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    from backend.db import init_db
    await init_db()
    await init_db()  # second call must not raise
