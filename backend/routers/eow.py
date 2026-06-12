"""
EOW (End-of-Week) scan endpoints.

POST /eow/scan   — manual trigger (runs in background)
GET  /eow/status — last scan status
"""
from fastapi import APIRouter, BackgroundTasks, Depends

from ..auth import get_current_user
from ..eow_service import get_eow_status, run_eow_scan

router = APIRouter(prefix="/eow", tags=["eow"])


@router.post("/scan")
async def trigger_eow_scan(
    background_tasks: BackgroundTasks,
    _: str = Depends(get_current_user),
):
    """Manually trigger an EOW scan. Returns immediately; scan runs in background."""
    background_tasks.add_task(run_eow_scan, "manual")
    return {"status": "started", "message": "EOW scan started in background"}


@router.get("/status")
async def eow_status(_: str = Depends(get_current_user)):
    """Return the status / result of the last EOW scan."""
    return get_eow_status()
