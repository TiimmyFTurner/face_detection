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
import concurrent.futures
import logging
import threading
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
    Manages per-camera RTSP processing loops with dedicated background worker threads.

    Each active camera gets its own thread that ingests frames independently,
    preventing thread starvation and ensuring that slow or offline cameras
    never block or delay other streaming cameras.
    """

    def __init__(self) -> None:
        self._threads: dict[int, threading.Thread] = {}  # camera_id -> worker thread
        self._stop_events: dict[int, threading.Event] = {}  # camera_id -> stop event
        self._cooldown_cache: dict[tuple[int, Optional[int]], float] = {}  # (camera_id, person_id) -> last_log_time
        self._known_persons_cache: list[KnownPerson] = []
        self._latest_frames: dict[int, bytes] = {}  # camera_id -> JPEG bytes
        self._camera_names: dict[int, str] = {}  # camera_id -> camera_name
        self._zones_cache: dict[int, list[dict]] = {}  # camera_id -> list of zone dicts
        self._zone_last_seen: dict[tuple[int, int], float] = {}  # (zone_id, person_id) -> timestamp
        self._zone_last_absence_alert: dict[tuple[int, int], float] = {}  # (zone_id, person_id) -> timestamp
        self._last_preview_time: dict[int, float] = {}  # camera_id -> timestamp of last JPEG encode
        self._camera_last_frame_time: dict[int, float] = {}  # camera_id -> timestamp of last successfully read frame
        self._camera_connected: dict[int, bool] = {}  # camera_id -> is stream actively open & receiving frames
        self._watchdog_task: Optional[asyncio.Task] = None
        self._cache_lock = asyncio.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ai_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="face-ai")
        self._processing_cameras: set[int] = set()

    @property
    def _tasks(self):
        """Backward compatibility alias for code checking camera task counts."""
        return self._threads

    def is_camera_online(self, camera_id: int) -> bool:
        """
        Check if a camera is actively connected and received a video frame
        within the last 15 seconds.
        """
        if not self._camera_connected.get(camera_id, False):
            return False
        last_time = self._camera_last_frame_time.get(camera_id, 0.0)
        is_alive = camera_id in self._threads and self._threads[camera_id].is_alive()
        return (time.time() - last_time) <= 15.0 and is_alive

    def get_online_cameras_count(self) -> int:
        """Count number of cameras that are actively connected and delivering frames."""
        return sum(1 for cam_id in list(self._threads.keys()) if self.is_camera_online(cam_id))

    def is_camera_in_detection_window(self, camera_id: int) -> bool:
        """
        Check if the camera is currently within its 2-second detection burst
        of the 30-second cycle window.
        If duty_stagger_cameras is enabled, cameras are evenly distributed across the 30s window.
        """
        window = getattr(settings, "duty_cycle_window", 30.0)
        burst = getattr(settings, "duty_burst_duration", 2.0)

        if burst >= window or window <= 0:
            return True  # Continuous detection

        now = time.time()
        cycle_time = now % window

        if not getattr(settings, "duty_stagger_cameras", True):
            return cycle_time < burst

        # Stagger across registered active cameras to eliminate CPU spikes
        active_ids = sorted(list(self._threads.keys()))
        if not active_ids:
            return cycle_time < burst

        try:
            cam_idx = active_ids.index(camera_id)
        except ValueError:
            cam_idx = 0

        total_cams = max(1, len(active_ids))
        step = min(burst, window / total_cams)
        slot_start = (cam_idx * step) % window
        slot_end = slot_start + burst

        if slot_end <= window:
            return slot_start <= cycle_time < slot_end
        else:
            return cycle_time >= slot_start or cycle_time < (slot_end % window)

    def get_latest_frame(self, camera_id: int) -> Optional[bytes]:
        """Get the most recent JPEG frame bytes for a camera."""
        return self._latest_frames.get(camera_id)

    async def start_all(self) -> None:
        """Start processing loops for all active cameras."""
        self._loop = asyncio.get_running_loop()
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

        logger.info("Started %d camera streams and absence watchdog.", len(self._threads))

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

        camera_ids = list(self._threads.keys())
        for camera_id in camera_ids:
            await self.stop_camera(camera_id)
        logger.info("All camera streams stopped.")

    async def start_camera(self, camera_id: int, camera_name: str, rtsp_url: str) -> None:
        """Start a processing loop for a specific camera in a dedicated thread."""
        if self._loop is None:
            self._loop = asyncio.get_running_loop()

        # Stop existing thread if running
        if camera_id in self._threads:
            await self.stop_camera(camera_id)

        self._camera_names[camera_id] = camera_name
        stop_event = threading.Event()
        self._stop_events[camera_id] = stop_event

        thread = threading.Thread(
            target=self._camera_worker,
            args=(camera_id, camera_name, rtsp_url, stop_event),
            name=f"cam-thread-{camera_id}",
            daemon=True,
        )
        self._threads[camera_id] = thread
        thread.start()
        logger.info("Started dedicated worker thread for camera %d ('%s').", camera_id, camera_name)

    async def stop_camera(self, camera_id: int) -> None:
        """Stop the processing loop for a specific camera."""
        if camera_id in self._stop_events:
            self._stop_events[camera_id].set()

        thread = self._threads.pop(camera_id, None)
        if thread and thread.is_alive():
            await asyncio.to_thread(thread.join, timeout=2.0)

        self._stop_events.pop(camera_id, None)
        self._latest_frames.pop(camera_id, None)
        self._camera_names.pop(camera_id, None)
        self._camera_connected.pop(camera_id, None)
        self._camera_last_frame_time.pop(camera_id, None)
        self._last_preview_time.pop(camera_id, None)
        self._processing_cameras.discard(camera_id)
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
                    if camera_id not in self._threads or not self._threads[camera_id].is_alive():
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

    def _camera_worker(
        self,
        camera_id: int,
        camera_name: str,
        rtsp_url: str,
        stop_event: threading.Event,
    ) -> None:
        """
        Dedicated per-camera worker thread.
        Performs non-blocking RTSP connection and continuous frame capture
        isolated from Python's asyncio thread pool.
        """
        backoff = 2
        frame_count = 0

        while not stop_event.is_set():
            cap = None
            try:
                logger.info("Connecting to RTSP stream for camera %d: %s", camera_id, rtsp_url)

                # Open RTSP stream using cv2.CAP_FFMPEG with fast connection and read timeouts
                try:
                    cap = cv2.VideoCapture(
                        rtsp_url,
                        cv2.CAP_FFMPEG,
                        [
                            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000,
                            cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000,
                        ],
                    )
                except Exception:
                    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

                if not cap.isOpened():
                    raise ConnectionError(f"Cannot open RTSP stream: {rtsp_url}")

                logger.info("Connected to camera %d ('%s').", camera_id, camera_name)
                backoff = 2  # Reset backoff on successful connection
                frame_count = 0

                while not stop_event.is_set():
                    ret, frame = cap.read()

                    if not ret or frame is None:
                        logger.warning("Frame read failed for camera %d. Reconnecting...", camera_id)
                        self._camera_connected[camera_id] = False
                        break

                    frame_count += 1
                    now = time.time()
                    self._camera_connected[camera_id] = True
                    self._camera_last_frame_time[camera_id] = now

                    # Throttled JPEG preview encoding (avoids high CPU preview encoding across 70+ cameras)
                    last_preview = self._last_preview_time.get(camera_id, 0.0)
                    preview_interval = 1.0 / max(0.1, getattr(settings, "live_preview_fps", 1.0))
                    if (now - last_preview) >= preview_interval:
                        try:
                            ret_enc, jpeg_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                            if ret_enc:
                                self._latest_frames[camera_id] = jpeg_buf.tobytes()
                                self._last_preview_time[camera_id] = now
                        except Exception:
                            pass

                    # Duty Cycle Gating: only run AI during camera's active detection window
                    if not self.is_camera_in_detection_window(camera_id):
                        time.sleep(0.02)
                        continue

                    # Frame skipping: process every Nth frame
                    if frame_count % settings.frame_skip != 0:
                        time.sleep(0.005)
                        continue

                    # Dispatch frame processing to asyncio loop via thread-safe call
                    if self._loop and self._loop.is_running() and camera_id not in self._processing_cameras:
                        self._processing_cameras.add(camera_id)
                        asyncio.run_coroutine_threadsafe(
                            self._safe_process_frame(frame, camera_id, camera_name),
                            self._loop,
                        )

                    time.sleep(0.01)

            except Exception as e:
                self._camera_connected[camera_id] = False
                logger.error(
                    "Stream error for camera %d: %s. Reconnecting in %ds...",
                    camera_id, e, backoff,
                )

            finally:
                self._camera_connected[camera_id] = False
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass

            # Interruptible backoff delay
            if not stop_event.is_set():
                stop_event.wait(timeout=backoff)
                backoff = min(backoff * 2, settings.max_reconnect_backoff)

    async def _safe_process_frame(
        self,
        frame: np.ndarray,
        camera_id: int,
        camera_name: str,
    ) -> None:
        """Helper to run frame processing on asyncio loop and ensure processing lock is released."""
        try:
            await self._process_frame(frame, camera_id, camera_name)
        except Exception as e:
            logger.error("Error processing frame for camera %d: %s", camera_id, e)
        finally:
            self._processing_cameras.discard(camera_id)

    async def _process_frame(
        self,
        frame: np.ndarray,
        camera_id: int,
        camera_name: str,
    ) -> None:
        """
        Run face detection, recognition, and event logging on a single frame.
        Supports Station Zone ROI cropping to minimize processed pixels.
        """
        if not face_engine.is_ready:
            return

        camera_zones = self._zones_cache.get(camera_id, [])
        crop_offset_x = 0
        crop_offset_y = 0
        input_frame = frame
        frame_h, frame_w = frame.shape[:2]

        # Station Zone (ROI) Cropping: Only detect faces within configured station areas
        if getattr(settings, "roi_crop_enabled", True) and camera_zones:
            min_x_pct = min(z["x"] for z in camera_zones)
            min_y_pct = min(z["y"] for z in camera_zones)
            max_x_pct = max(z["x"] + z["width"] for z in camera_zones)
            max_y_pct = max(z["y"] + z["height"] for z in camera_zones)

            pad_x = (max_x_pct - min_x_pct) * 0.10
            pad_y = (max_y_pct - min_y_pct) * 0.10

            x1 = max(0, int((min_x_pct - pad_x) * frame_w / 100.0))
            y1 = max(0, int((min_y_pct - pad_y) * frame_h / 100.0))
            x2 = min(frame_w, int((max_x_pct + pad_x) * frame_w / 100.0))
            y2 = min(frame_h, int((max_y_pct + pad_y) * frame_h / 100.0))

            roi_w = x2 - x1
            roi_h = y2 - y1

            # Only use ROI if valid size (at least 60x60 pixels)
            if roi_w >= 60 and roi_h >= 60:
                input_frame = frame[y1:y2, x1:x2]
                crop_offset_x = x1
                crop_offset_y = y1

        # Downscale for detection performance
        scale = settings.downscale_factor
        if scale < 1.0:
            small = cv2.resize(
                input_frame,
                None,
                fx=scale,
                fy=scale,
                interpolation=cv2.INTER_LINEAR,
            )
        else:
            small = input_frame

        # Detect faces (blocking call offloaded to dedicated AI thread pool)
        faces: list[DetectedFace] = await asyncio.get_event_loop().run_in_executor(
            self._ai_executor, face_engine.detect_and_embed, small
        )

        if not faces:
            return

        # Scale bounding boxes back to original full-frame coordinates
        inv_scale = 1.0 / scale if scale < 1.0 else 1.0
        for face in faces:
            bx1 = int(face.bbox[0] * inv_scale) + crop_offset_x
            by1 = int(face.bbox[1] * inv_scale) + crop_offset_y
            bx2 = int(face.bbox[2] * inv_scale) + crop_offset_x
            by2 = int(face.bbox[3] * inv_scale) + crop_offset_y
            face.bbox = (bx1, by1, bx2, by2)

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

            # Check if logging unknown persons is disabled in settings
            if not match.is_known and not getattr(settings, "log_unknown_faces", True):
                # If unknown person enters a restricted zone with unauthorized entry policy, still evaluate alert
                is_unauthorized = False
                if matched_zone:
                    mode = matched_zone.get("alert_mode", "")
                    assigned_ids = matched_zone.get("assigned_person_ids", [])
                    if mode in ("unauthorized", "unauthorized_entry", "both") and assigned_ids:
                        is_unauthorized = True
                if not is_unauthorized:
                    continue  # Skip event logging for unknown face

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
