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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.database import init_db
from backend.face_engine import face_engine
from backend.stream_processor import stream_processor, ws_manager
from backend.routers import cameras, persons, events, snapshots

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

    logger.info("System ready. Dashboard: http://%s:%s", settings.host, settings.port)
    logger.info("=" * 60)

    yield  # ── Application is running ──

    # Shutdown
    logger.info("Shutting down...")
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


# ── API Routers ──────────────────────────────────────────
app.include_router(cameras.router)
app.include_router(persons.router)
app.include_router(events.router)
app.include_router(snapshots.router)


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
async def websocket_events(websocket: WebSocket):
    """
    WebSocket endpoint for real-time event streaming.
    Clients connect here to receive instant notifications of new detection events.
    """
    await ws_manager.connect(websocket)
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
