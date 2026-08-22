"""
RTSP Stream Processor — Background worker for real-time face detection.

Manages per-camera processing loops that:
  - Connect to RTSP streams via OpenCV
  - Apply frame skipping and downscaling for performance
  - Run face detection & recognition via FaceEngine
  - Log events to the database
  - Broadcast events to WebSocket clients
  - Auto-reconnect on stream drops with exponential backoff
"""

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import async_session
from backend.face_engine import face_engine, KnownPerson, DetectedFace
from backend.models import Camera, Person, PersonEmbedding, Event

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages WebSocket connections for real-time event broadcasting."""

    def __init__(self) -> None:
        self._connections: list = []

    async def connect(self, websocket) -> None:
        await websocket.accept()
        self._connections.append(websocket)
        logger.info("WebSocket client connected. Total: %d", len(self._connections))

    def disconnect(self, websocket) -> None:
        if websocket in self._connections:
            self._connections.remove(websocket)
        logger.info("WebSocket client disconnected. Total: %d", len(self._connections))

    async def broadcast(self, message: dict) -> None:
        """Send a message to all connected WebSocket clients."""
        import json
        payload = json.dumps(message, default=str)
        stale = []
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(ws)
        # Clean up stale connections
        for ws in stale:
            self.disconnect(ws)


# Module-level singleton
ws_manager = WebSocketManager()


class StreamProcessor:
    """
    Manages per-camera RTSP processing loops as asyncio background tasks.

    Each active camera gets its own task that reads frames, detects faces,
    matches against known persons, and logs events.
    """

    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task] = {}  # camera_id -> task
        self._stop_flags: dict[int, asyncio.Event] = {}  # camera_id -> stop event
        self._cooldown_cache: dict[tuple[int, Optional[int]], float] = {}  # (camera_id, person_id) -> last_log_time
        self._known_persons_cache: list[KnownPerson] = []
        self._latest_frames: dict[int, bytes] = {}  # camera_id -> JPEG bytes
        self._cache_lock = asyncio.Lock()

    def get_latest_frame(self, camera_id: int) -> Optional[bytes]:
        """Get the most recent JPEG frame bytes for a camera."""
        return self._latest_frames.get(camera_id)

    async def start_all(self) -> None:
        """Start processing loops for all active cameras."""
        logger.info("Starting stream processor for all active cameras...")
        await self.refresh_known_persons()

        async with async_session() as session:
            result = await session.execute(
                select(Camera).where(Camera.is_active == True)  # noqa: E712
            )
            cameras = result.scalars().all()

        for camera in cameras:
            await self.start_camera(camera.id, camera.name, camera.rtsp_url)

        logger.info("Started %d camera streams.", len(self._tasks))

    async def stop_all(self) -> None:
        """Stop all camera processing loops gracefully."""
        logger.info("Stopping all camera streams...")
        camera_ids = list(self._tasks.keys())
        for camera_id in camera_ids:
            await self.stop_camera(camera_id)
        logger.info("All camera streams stopped.")

    async def start_camera(self, camera_id: int, camera_name: str, rtsp_url: str) -> None:
        """Start a processing loop for a specific camera."""
        # Stop existing task if running
        if camera_id in self._tasks:
            await self.stop_camera(camera_id)

        stop_event = asyncio.Event()
        self._stop_flags[camera_id] = stop_event

        task = asyncio.create_task(
            self._camera_loop(camera_id, camera_name, rtsp_url, stop_event),
            name=f"camera-{camera_id}",
        )
        self._tasks[camera_id] = task
        logger.info("Started stream for camera %d ('%s').", camera_id, camera_name)

    async def stop_camera(self, camera_id: int) -> None:
        """Stop the processing loop for a specific camera."""
        if camera_id in self._stop_flags:
            self._stop_flags[camera_id].set()

        if camera_id in self._tasks:
            task = self._tasks.pop(camera_id)
            try:
                await asyncio.wait_for(task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
            except Exception as e:
                logger.warning("Error stopping camera %d: %s", camera_id, e)

        self._stop_flags.pop(camera_id, None)
        self._latest_frames.pop(camera_id, None)
        logger.info("Stopped stream for camera %d.", camera_id)

    async def refresh_known_persons(self) -> None:
        """Reload all known person embeddings from the database into cache."""
        async with self._cache_lock:
            known: list[KnownPerson] = []

            async with async_session() as session:
                result = await session.execute(
                    select(Person)
                )
                persons = result.scalars().all()

                for person in persons:
                    # Eagerly load embeddings
                    emb_result = await session.execute(
                        select(PersonEmbedding).where(
                            PersonEmbedding.person_id == person.id
                        )
                    )
                    emb_rows = emb_result.scalars().all()

                    if emb_rows:
                        kp = KnownPerson(
                            person_id=person.id,
                            person_name=person.name,
                            embeddings=[
                                np.array(e.embedding, dtype=np.float32)
                                for e in emb_rows
                            ],
                        )
                        known.append(kp)

            self._known_persons_cache = known
            logger.info("Refreshed known persons cache: %d persons loaded.", len(known))

    async def _camera_loop(
        self,
        camera_id: int,
        camera_name: str,
        rtsp_url: str,
        stop_event: asyncio.Event,
    ) -> None:
        """
        Main per-camera processing loop.
        Runs in an asyncio task, offloading blocking OpenCV I/O to a thread executor.
        """
        backoff = 2  # Initial reconnect delay in seconds
        frame_count = 0

        while not stop_event.is_set():
            cap = None
            try:
                logger.info("Connecting to RTSP stream for camera %d: %s", camera_id, rtsp_url)

                # Open RTSP stream in thread to avoid blocking event loop
                cap = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: cv2.VideoCapture(rtsp_url)
                )

                if not cap.isOpened():
                    raise ConnectionError(f"Cannot open RTSP stream: {rtsp_url}")

                logger.info("Connected to camera %d ('%s').", camera_id, camera_name)
                backoff = 2  # Reset backoff on successful connection
                frame_count = 0

                while not stop_event.is_set():
                    # Read frame in thread
                    ret, frame = await asyncio.get_event_loop().run_in_executor(
                        None, cap.read
                    )

                    if not ret or frame is None:
                        logger.warning("Frame read failed for camera %d. Reconnecting...", camera_id)
                        break

                    frame_count += 1

                    # Update latest JPEG frame for live camera view
                    try:
                        ret_enc, jpeg_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                        if ret_enc:
                            self._latest_frames[camera_id] = jpeg_buf.tobytes()
                    except Exception:
                        pass

                    # Frame skipping: only process every Nth frame for AI face detection
                    if frame_count % settings.frame_skip != 0:
                        await asyncio.sleep(0.005)
                        continue

                    # Process frame (detection + matching + logging)
                    await self._process_frame(frame, camera_id, camera_name)

                    # Yield control to event loop
                    await asyncio.sleep(0.01)

            except Exception as e:
                logger.error(
                    "Stream error for camera %d: %s. Reconnecting in %ds...",
                    camera_id, e, backoff,
                )

            finally:
                if cap is not None:
                    await asyncio.get_event_loop().run_in_executor(None, cap.release)

            # Exponential backoff before reconnecting
            if not stop_event.is_set():
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, settings.max_reconnect_backoff)

    async def _process_frame(
        self,
        frame: np.ndarray,
        camera_id: int,
        camera_name: str,
    ) -> None:
        """
        Run face detection, recognition, and event logging on a single frame.
        """
        # Save latest JPEG frame for live camera view & snapshot
        try:
            ret, jpeg_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ret:
                self._latest_frames[camera_id] = jpeg_buf.tobytes()
        except Exception as e:
            logger.warning("Failed to encode JPEG frame for camera %d: %s", camera_id, e)

        if not face_engine.is_ready:
            return

        # Downscale for detection performance
        scale = settings.downscale_factor
        if scale < 1.0:
            small = cv2.resize(
                frame,
                None,
                fx=scale,
                fy=scale,
                interpolation=cv2.INTER_LINEAR,
            )
        else:
            small = frame

        # Detect faces (blocking call offloaded to thread)
        faces: list[DetectedFace] = await asyncio.get_event_loop().run_in_executor(
            None, face_engine.detect_and_embed, small
        )

        if not faces:
            return

        # Scale bounding boxes back to original frame size
        if scale < 1.0:
            inv_scale = 1.0 / scale
            for face in faces:
                face.bbox = tuple(int(v * inv_scale) for v in face.bbox)

        # Get known persons from cache
        async with self._cache_lock:
            known = self._known_persons_cache

        for face in faces:
            # Match against known persons
            match = face_engine.match(face.embedding, known)

            # Check cooldown
            cooldown_key = (camera_id, match.person_id)
            now = time.time()
            last_logged = self._cooldown_cache.get(cooldown_key, 0)

            if now - last_logged < settings.cooldown_seconds:
                continue  # Skip — too soon to re-log this person

            self._cooldown_cache[cooldown_key] = now

            # Save cropped face snapshot
            snapshot_filename = f"{uuid.uuid4().hex}.jpg"
            snapshot_path = Path(settings.snapshot_dir) / snapshot_filename

            try:
                cropped = face_engine.crop_face(frame, face.bbox)
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda p=str(snapshot_path), c=cropped: cv2.imwrite(
                        p, c, [cv2.IMWRITE_JPEG_QUALITY, 98, cv2.IMWRITE_JPEG_OPTIMIZE, 1]
                    ),
                )
            except Exception as e:
                logger.warning("Failed to save snapshot: %s", e)
                continue

            # Log event to database
            try:
                async with async_session() as session:
                    event = Event(
                        timestamp=datetime.now(timezone.utc),
                        camera_id=camera_id,
                        person_id=match.person_id,
                        person_name=match.person_name,
                        confidence_score=round(match.confidence, 4),
                        snapshot_path=snapshot_filename,
                        is_known=match.is_known,
                    )
                    session.add(event)
                    await session.commit()
                    await session.refresh(event)

                    # Broadcast via WebSocket
                    event_data = {
                        "type": "new_event",
                        "event": {
                            "id": event.id,
                            "timestamp": event.timestamp.isoformat(),
                            "camera_id": camera_id,
                            "camera_name": camera_name,
                            "person_id": match.person_id,
                            "person_name": match.person_name,
                            "confidence_score": match.confidence,
                            "snapshot_url": f"/api/snapshots/{snapshot_filename}",
                            "is_known": match.is_known,
                        },
                    }
                    await ws_manager.broadcast(event_data)

                    logger.info(
                        "Event logged: camera=%s person=%s confidence=%.2f known=%s",
                        camera_name,
                        match.person_name,
                        match.confidence,
                        match.is_known,
                    )

            except Exception as e:
                logger.error("Failed to log event: %s", e)


# Module-level singleton
stream_processor = StreamProcessor()
