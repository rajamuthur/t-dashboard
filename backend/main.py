import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import router as auth_router
from .db import init_db
from .downloaders.scheduler import start_scheduler, stop_scheduler
from .routers.candles import router as candles_router
from .routers.config import router as config_router
from .routers.daily_scans import router as daily_scans_router
from .routers.eow import router as eow_router
from .routers.health import router as health_router
from .routers.holidays import router as holidays_router
from .routers.live_charts import router as live_charts_router
from .routers.scans import router as scans_router
from .routers.sync import router as sync_router
from .routers.trades import router as trades_router


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await init_db()
        start_scheduler()
        yield
        stop_scheduler()

    application = FastAPI(title="Fyers Dashboard API", version="1.0.0", lifespan=lifespan)

    # CORS — local dev defaults plus any comma-separated origins from
    # CORS_ORIGINS (set this on Fly.io to your deployed frontend domain).
    default_origins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
    ]
    extra = [o.strip() for o in (os.getenv("CORS_ORIGINS") or "").split(",") if o.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=default_origins + extra,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Total-Count"],
    )
    application.include_router(auth_router)
    application.include_router(candles_router)
    application.include_router(scans_router)
    application.include_router(daily_scans_router)
    application.include_router(config_router)
    application.include_router(sync_router)
    application.include_router(eow_router)
    application.include_router(holidays_router)
    application.include_router(live_charts_router)
    application.include_router(trades_router)
    application.include_router(health_router)
    return application


app = create_app()

