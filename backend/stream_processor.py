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
from backend.models import Camera, Person, PersonEmbedding, Event, CameraZone

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
        self._camera_names: dict[int, str] = {}  # camera_id -> camera_name
        self._zones_cache: dict[int, list[dict]] = {}  # camera_id -> list of zone dicts
        self._zone_last_seen: dict[tuple[int, int], float] = {}  # (zone_id, person_id) -> timestamp
        self._zone_last_absence_alert: dict[tuple[int, int], float] = {}  # (zone_id, person_id) -> timestamp
        self._watchdog_task: Optional[asyncio.Task] = None
        self._cache_lock = asyncio.Lock()

    def get_latest_frame(self, camera_id: int) -> Optional[bytes]:
        """Get the most recent JPEG frame bytes for a camera."""
        return self._latest_frames.get(camera_id)

    async def start_all(self) -> None:
        """Start processing loops for all active cameras."""
        logger.info("Starting stream processor for all active cameras...")
        await self.refresh_known_persons()
        await self.refresh_zones()

        async with async_session() as session:
            result = await session.execute(
                select(Camera).where(Camera.is_active == True)  # noqa: E712
            )
            cameras = result.scalars().all()

        for camera in cameras:
            await self.start_camera(camera.id, camera.name, camera.rtsp_url)

        # Start periodic absence watchdog loop
        if self._watchdog_task is None or self._watchdog_task.done():
            self._watchdog_task = asyncio.create_task(
                self._absence_watchdog_loop(),
                name="zone-absence-watchdog",
            )

        logger.info("Started %d camera streams and absence watchdog.", len(self._tasks))

    async def stop_all(self) -> None:
        """Stop all camera processing loops gracefully."""
        logger.info("Stopping all camera streams...")
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except asyncio.CancelledError:
                pass
            self._watchdog_task = None

        camera_ids = list(self._tasks.keys())
        for camera_id in camera_ids:
            await self.stop_camera(camera_id)
        logger.info("All camera streams stopped.")

    async def start_camera(self, camera_id: int, camera_name: str, rtsp_url: str) -> None:
        """Start a processing loop for a specific camera."""
        # Stop existing task if running
        if camera_id in self._tasks:
            await self.stop_camera(camera_id)

        self._camera_names[camera_id] = camera_name
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
        self._camera_names.pop(camera_id, None)
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

    async def refresh_zones(self) -> None:
        """Reload all active camera zones from the database into cache."""
        async with self._cache_lock:
            zones_map: dict[int, list[dict]] = {}

            async with async_session() as session:
                cams_result = await session.execute(select(Camera))
                for c in cams_result.scalars().all():
                    self._camera_names[c.id] = c.name

                result = await session.execute(
                    select(CameraZone).where(CameraZone.is_active == True)  # noqa: E712
                )
                zones = result.scalars().all()

                for z in zones:
                    if z.camera_id not in zones_map:
                        zones_map[z.camera_id] = []
                    zones_map[z.camera_id].append({
                        "id": z.id,
                        "camera_id": z.camera_id,
                        "name": z.name,
                        "x": z.x,
                        "y": z.y,
                        "width": z.width,
                        "height": z.height,
                        "alert_mode": z.alert_mode,
                        "assigned_person_ids": z.assigned_person_ids or [],
                        "start_time": z.start_time or "00:00",
                        "end_time": z.end_time or "23:59",
                        "active_days": z.active_days or ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                    })

            self._zones_cache = zones_map
            logger.info("Refreshed camera zones cache: %d cameras with configured zones.", len(zones_map))

    @staticmethod
    def _is_zone_in_schedule(start_time: str, end_time: str, active_days: list[str]) -> bool:
        """Check if current time is within active shift hours and days."""
        now = datetime.now()
        day_name = now.strftime("%a")

        if active_days and day_name not in active_days:
            return False

        current_hm = now.strftime("%H:%M")
        start = start_time or "00:00"
        end = end_time or "23:59"

        if start <= end:
            return start <= current_hm <= end
        else:
            return current_hm >= start or current_hm <= end

    async def _absence_watchdog_loop(self) -> None:
        """
        Periodic background watchdog: check if assigned persons are missing
        from their designated zones for >= 60 seconds and broadcast alerts
        (only during scheduled timetable hours).
        """
        # Initial 5-second grace period after system startup
        await asyncio.sleep(5)

        while True:
            try:
                now = time.time()
                async with self._cache_lock:
                    zones_snapshot = list(self._zones_cache.items())
                    known_persons_map = {kp.person_id: kp.person_name for kp in self._known_persons_cache}

                for camera_id, zones in zones_snapshot:
                    # Only check active streaming cameras
                    if camera_id not in self._tasks or self._tasks[camera_id].done():
                        continue

                    camera_name = self._camera_names.get(camera_id, f"Camera #{camera_id}")

                    for zone in zones:
                        # Check timetable shift hours
                        if not self._is_zone_in_schedule(
                            zone.get("start_time", "00:00"),
                            zone.get("end_time", "23:59"),
                            zone.get("active_days", []),
                        ):
                            continue  # Off duty — suppress absence alerts

                        mode = zone.get("alert_mode", "absence")
                        if mode not in ("absence", "both", "out_of_zone"):
                            continue

                        assigned_ids = zone.get("assigned_person_ids", [])
                        for person_id in assigned_ids:
                            key = (zone["id"], person_id)
                            last_seen = self._zone_last_seen.get(key, 0)

                            # If never seen since startup, initialize timer to now
                            if last_seen == 0:
                                self._zone_last_seen[key] = now
                                continue

                            # Check if person has been missing from zone for >= 60 seconds (1 minute)
                            if (now - last_seen) >= 120.0:
                                last_alert = self._zone_last_absence_alert.get(key, 0)
                                # Throttle absence alert events to at most once every 2 minutes
                                if (now - last_alert) >= 300.0:
                                    self._zone_last_absence_alert[key] = now
                                    person_name = known_persons_map.get(person_id, f"Person #{person_id}")
                                    minutes_absent = max(1, int((now - last_seen) // 60))
                                    time_desc = f"{minutes_absent} min" if minutes_absent == 1 else f"{minutes_absent} mins"
                                    message = (
                                        f"⚠️ Absence Alert: {person_name} is NOT in assigned area "
                                        f"'{zone['name']}' (missing for {time_desc})"
                                    )
                                    logger.warning(message)

                                    saved_event_id = None
                                    saved_snapshot = ""
                                    absent_duration_secs = int(now - last_seen)
                                    try:
                                        async with async_session() as session:
                                            pres = await session.execute(
                                                select(PersonEmbedding)
                                                .where(PersonEmbedding.person_id == person_id)
                                                .order_by(PersonEmbedding.id.asc())
                                            )
                                            emb_obj = pres.scalars().first()
                                            if emb_obj and emb_obj.reference_photo_path:
                                                ref_name = Path(emb_obj.reference_photo_path).name
                                                saved_snapshot = f"ref_{ref_name}"

                                            evt = Event(
                                                timestamp=datetime.now(timezone.utc),
                                                camera_id=camera_id,
                                                person_id=person_id,
                                                person_name=person_name,
                                                confidence_score=1.0,
                                                snapshot_path=saved_snapshot,
                                                is_known=True,
                                                zone_id=zone["id"],
                                                zone_name=zone["name"],
                                                alert_type="absence_timeout",
                                                duration_seconds=absent_duration_secs,
                                            )
                                            session.add(evt)
                                            await session.commit()
                                            await session.refresh(evt)
                                            saved_event_id = evt.id
                                    except Exception as db_err:
                                        logger.error("Failed to log absence event to DB: %s", db_err)

                                    await ws_manager.broadcast({
                                        "type": "zone_alert",
                                        "alert_type": "absence_timeout",
                                        "message": message,
                                        "event": {
                                            "id": saved_event_id or int(time.time()),
                                            "timestamp": datetime.now(timezone.utc).isoformat(),
                                            "camera_id": camera_id,
                                            "camera_name": camera_name,
                                            "person_id": person_id,
                                            "person_name": person_name,
                                            "confidence_score": 1.0,
                                            "snapshot_url": f"/api/snapshots/{saved_snapshot}" if saved_snapshot else "",
                                            "snapshot_path": saved_snapshot,
                                            "is_known": True,
                                            "zone_id": zone["id"],
                                            "zone_name": zone["name"],
                                            "alert_type": "absence_timeout",
                                            "duration_seconds": absent_duration_secs,
                                            "duration_str": time_desc,
                                        },
                                        "zone_id": zone["id"],
                                        "zone_name": zone["name"],
                                        "camera_id": camera_id,
                                        "camera_name": camera_name,
                                        "person_id": person_id,
                                        "person_name": person_name,
                                        "duration_seconds": absent_duration_secs,
                                        "duration_str": time_desc,
                                        "timestamp": datetime.now(timezone.utc).isoformat(),
                                    })

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in absence watchdog loop: %s", e)

            await asyncio.sleep(5)  # Check every 5 seconds

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
            ret, jpeg_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 100])
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

            frame_h, frame_w = frame.shape[:2]
            face_cx = ((face.bbox[0] + face.bbox[2]) / 2.0 / max(1, frame_w)) * 100.0
            face_cy = ((face.bbox[1] + face.bbox[3]) / 2.0 / max(1, frame_h)) * 100.0

            # Evaluate Camera Zones / Important Areas
            camera_zones = self._zones_cache.get(camera_id, [])
            matched_zone = None
            for zone in camera_zones:
                if (zone["x"] <= face_cx <= (zone["x"] + zone["width"]) and
                    zone["y"] <= face_cy <= (zone["y"] + zone["height"])):
                    matched_zone = zone
                    break

            # Always update presence heartbeat for assigned staff on EVERY frame
            now = time.time()
            if matched_zone and match.person_id:
                self._zone_last_seen[(matched_zone["id"], match.person_id)] = now

            # Check cooldown key for logging event to database & live feed
            if match.person_id:
                cooldown_key = (camera_id, match.person_id)
            else:
                grid_x = int(face_cx // 15)  # 15% grid granularity
                grid_y = int(face_cy // 15)
                cooldown_key = (camera_id, f"unknown_{grid_x}_{grid_y}")

            last_logged = self._cooldown_cache.get(cooldown_key, 0)
            if now - last_logged < settings.cooldown_seconds:
                continue  # Skip event logging — cooldown active (presence heartbeat already updated above)

            self._cooldown_cache[cooldown_key] = now

            zone_id = matched_zone["id"] if matched_zone else None
            zone_name = matched_zone["name"] if matched_zone else ""
            alert_type = "normal"
            alert_message = ""

            # Rule 1: Out of Designated Area Alert
            # ONLY trigger if the zone policy is explicitly configured for immediate out_of_zone or both
            if match.person_id:
                for zone in camera_zones:
                    assigned_ids = zone.get("assigned_person_ids", [])
                    if match.person_id in assigned_ids:
                        mode = zone.get("alert_mode", "absence")
                        if mode in ("out_of_zone", "both"):
                            if not matched_zone or matched_zone["id"] != zone["id"]:
                                alert_type = "out_of_zone"
                                alert_message = f"⚠️ Alert: {match.person_name} is NOT in assigned area '{zone['name']}' on {camera_name}"
                                break

            # Rule 2: Unauthorized Entry Alert
            if matched_zone and alert_type == "normal":
                mode = matched_zone.get("alert_mode", "")
                assigned_ids = matched_zone.get("assigned_person_ids", [])
                if mode in ("unauthorized", "unauthorized_entry", "both") and assigned_ids:
                    if not match.person_id or match.person_id not in assigned_ids:
                        alert_type = "unauthorized_entry"
                        alert_message = f"🚨 Alert: Unauthorized person ({match.person_name}) in restricted area '{matched_zone['name']}' on {camera_name}"

            # Save cropped face snapshot (if enabled in settings)
            snapshot_filename = ""
            if getattr(settings, "save_snapshots", True):
                snapshot_filename = f"{uuid.uuid4().hex}.jpg"
                snapshot_path = Path(settings.snapshot_dir) / snapshot_filename

                try:
                    cropped = face_engine.crop_face(frame, face.bbox)
                    await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda p=str(snapshot_path), c=cropped: cv2.imwrite(
                            p, c, [cv2.IMWRITE_JPEG_QUALITY, 100, cv2.IMWRITE_JPEG_OPTIMIZE, 1]
                        ),
                    )
                except Exception as e:
                    logger.warning("Failed to save snapshot: %s", e)
                    snapshot_filename = ""

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
                        zone_id=zone_id,
                        zone_name=zone_name,
                        alert_type=alert_type,
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
                            "snapshot_url": f"/api/snapshots/{snapshot_filename}" if snapshot_filename else "",
                            "snapshot_path": snapshot_filename,
                            "is_known": match.is_known,
                            "zone_id": zone_id,
                            "zone_name": zone_name,
                            "alert_type": alert_type,
                        },
                    }
                    await ws_manager.broadcast(event_data)

                    # If alert triggered, broadcast high-priority zone_alert
                    if alert_type != "normal":
                        await ws_manager.broadcast({
                            "type": "zone_alert",
                            "alert_type": alert_type,
                            "message": alert_message,
                            "event": event_data["event"],
                        })

                    logger.info(
                        "Event logged: camera=%s person=%s confidence=%.2f known=%s alert=%s",
                        camera_name,
                        match.person_name,
                        match.confidence,
                        match.is_known,
                        alert_type,
                    )

            except Exception as e:
                logger.error("Failed to log event: %s", e)


# Module-level singleton
stream_processor = StreamProcessor()
