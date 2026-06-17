"""Intraday backtest endpoints (Phase 1)."""
import json
from typing import Optional

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from ..auth import get_current_user
from ..db import get_db
from ..intraday_backtest import run_backtest, get_backtest_status, DEFAULT_COST_PCT
from ..strategies import list_strategies, strategy_keys
from ..universe_service import list_universes, UNIVERSES

router = APIRouter(prefix="/backtest", tags=["backtest"])


@router.get("/strategies")
async def strategies(_: str = Depends(get_current_user)):
    return list_strategies()


@router.get("/universes")
async def universes(_: str = Depends(get_current_user)):
    return await list_universes()


@router.post("/run")
async def run(
    background_tasks: BackgroundTasks,
    strategy: str = Query(...),
    universe: str = Query(default="fo"),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    cost_pct: float = Query(default=DEFAULT_COST_PCT, ge=0.0, le=2.0),
    _: str = Depends(get_current_user),
):
    if strategy not in strategy_keys():
        raise HTTPException(400, f"Unknown strategy: {strategy}")
    if universe not in UNIVERSES:
        raise HTTPException(400, f"Unknown universe: {universe}")
    background_tasks.add_task(run_backtest, strategy, universe, from_date, to_date, cost_pct)
    return {"status": "started", "strategy": strategy, "universe": universe}


@router.get("/status")
async def status(_: str = Depends(get_current_user)):
    return get_backtest_status()


@router.get("/runs")
async def runs(
    limit: int = Query(default=30, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    try:
        async with db.execute(
            "SELECT id, strategy, universe, from_date, to_date, cost_pct, created_at, result"
            " FROM backtest_runs ORDER BY id DESC LIMIT ?", [limit],
        ) as cur:
            rows = await cur.fetchall()
    except Exception:
        return []   # table not created yet (no runs)
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["overall"] = json.loads(d.pop("result")).get("overall")
        except Exception:
            d["overall"] = None
        out.append(d)
    return out


@router.get("/runs/{run_id}")
async def run_detail(
    run_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    _: str = Depends(get_current_user),
):
    db.row_factory = aiosqlite.Row
    async with db.execute("SELECT * FROM backtest_runs WHERE id=?", [run_id]) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Backtest run not found")
    d = dict(row)
    d["result"] = json.loads(d["result"]) if d.get("result") else None
    return d
