"""
FastAPI application entry point.

Sets up:
  - Lifespan events (database init, FaceEngine init, stream processor start/stop)
  - API routers (cameras, persons, events, snapshots)
  - WebSocket endpoint for real-time event streaming
  - Static file serving for the frontend dashboard
  - Health check endpoint
"""

import logging
from contextlib import asynccontextmanager

from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.database import init_db
from backend.face_engine import face_engine
from backend.stream_processor import stream_processor, ws_manager
from backend.snapshot_cleanup import retention_worker
from backend.routers import auth, break_presets, cameras, events, persons, roles, sections, snapshots, system, users, zones

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-8s │ %(name)s │ %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan (startup / shutdown) ────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize resources on startup, clean up on shutdown."""
    logger.info("=" * 60)
    logger.info("  Face Tracking & Logging System — Starting Up")
    logger.info("=" * 60)

    # Ensure data directories exist
    settings.ensure_directories()

    # Initialize database tables
    await init_db()
    logger.info("Database initialized.")

    # Initialize face detection/recognition engine
    try:
        face_engine.init()
    except Exception as e:
        logger.error(
            "FaceEngine failed to initialize: %s. "
            "The system will start but face detection will be unavailable. "
            "Install insightface and onnxruntime to enable detection.",
            e,
        )

    # Start RTSP stream processing for all active cameras
    try:
        await stream_processor.start_all()
    except Exception as e:
        logger.error("Stream processor failed to start: %s", e)

    # Start automated snapshot and event log retention worker
    try:
        retention_worker.start()
    except Exception as e:
        logger.error("Retention worker failed to start: %s", e)

    logger.info("System ready. Dashboard: http://%s:%s", settings.host, settings.port)
    logger.info("=" * 60)

    yield  # ── Application is running ──

    # Shutdown
    logger.info("Shutting down...")
    await retention_worker.stop()
    await stream_processor.stop_all()
    logger.info("Shutdown complete.")


# ── FastAPI App ──────────────────────────────────────────
app = FastAPI(
    title="Face Tracking & Logging System",
    description="Self-hosted real-time face detection and recognition for IP cameras.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── No-Cache Middleware for Static Frontend Assets ───────
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ── API Routers ──────────────────────────────────────────
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(sections.router)
app.include_router(cameras.router)
app.include_router(persons.router)
app.include_router(events.router)
app.include_router(snapshots.router)
app.include_router(zones.router)
app.include_router(break_presets.router)
app.include_router(system.router)


# ── Health Check ─────────────────────────────────────────
@app.get("/api/health", tags=["system"])
async def health_check():
    """Health check endpoint for Docker and monitoring."""
    return {
        "status": "healthy",
        "face_engine_ready": face_engine.is_ready,
        "version": "1.0.0",
    }


# ── WebSocket: Real-time Events ──────────────────────────
@app.websocket("/ws/events")
async def websocket_events(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """
    WebSocket endpoint for real-time event streaming.
    Clients connect here to receive instant notifications of new detection events.
    Enforces supervisor scoping: supervisors only receive events and notifications for assigned persons.
    """
    auth_token = token or websocket.cookies.get("access_token")
    user_scope = None
    is_supervisor = False

    if auth_token:
        try:
            from backend.auth import decode_access_token, get_user_scope
            from backend.models import User
            import backend.database as db_mod
            import backend.stream_processor as sp_mod
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload

            session_factory = getattr(sp_mod, "async_session", None) or getattr(db_mod, "async_session", None)
            payload = decode_access_token(auth_token)
            if payload and payload.get("sub") and session_factory:
                async with session_factory() as session:
                    stmt = select(User).options(selectinload(User.role)).where(User.id == payload["sub"])
                    user = (await session.execute(stmt)).scalar_one_or_none()
                    if user:
                        user_scope = await get_user_scope(user, session)
                        is_supervisor = bool(user.role and user.role.name == "supervisor")
        except Exception as e:
            logger.warning("Failed to authenticate WebSocket connection: %s", e)

    await ws_manager.connect(websocket, scope=user_scope, is_supervisor=is_supervisor)
    try:
        # Keep connection alive, listen for client messages (e.g., ping)
        while True:
            data = await websocket.receive_text()
            # Echo pings or handle commands if needed
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


# ── Static Files: Frontend Dashboard ────────────────────
# Mount AFTER API routes so /api/* paths take priority
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
