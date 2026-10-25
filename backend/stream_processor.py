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
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import async_session
from backend.face_engine import face_engine, KnownPerson, DetectedFace
from backend.models import Camera, Person, PersonEmbedding, Event, CameraZone, ShiftTemplate
from backend.shift_utils import (
    get_shift_window,
    is_time_in_timetable,
    is_time_in_free_time,
    get_rotation_day_state,
    _to_local_dt,
    _format_duration,
)

logger = logging.getLogger(__name__)


class WebSocketClient:
    """Represents a connected WebSocket client with optional access scope and supervisor role."""

    def __init__(self, ws, scope=None, is_supervisor: bool = False):
        self.ws = ws
        self.scope = scope
        self.is_supervisor = is_supervisor

    def __eq__(self, other):
        if isinstance(other, WebSocketClient):
            return self.ws == other.ws
        return self.ws == other


class WebSocketManager:
    """Manages WebSocket connections for real-time event broadcasting."""

    def __init__(self) -> None:
        self._connections: list[WebSocketClient] = []

    async def connect(self, websocket, scope=None, is_supervisor: bool = False) -> None:
        await websocket.accept()
        self._connections.append(WebSocketClient(websocket, scope=scope, is_supervisor=is_supervisor))
        logger.info(
            "WebSocket client connected (supervisor=%s, scoped=%s). Total: %d",
            is_supervisor,
            bool(scope and scope.is_scoped),
            len(self._connections),
        )

    def disconnect(self, websocket) -> None:
        if websocket in self._connections:
            self._connections.remove(websocket)
        logger.info("WebSocket client disconnected. Total: %d", len(self._connections))

    async def broadcast(self, message: dict) -> None:
        """Send a message to all connected WebSocket clients, filtering by supervisor scope."""
        import json
        stale = []
        for client in list(self._connections):
            ws = client.ws
            scope = client.scope
            is_supervisor = client.is_supervisor

            # Scoped filtering for supervisors: only send assigned persons events/notifications
            if scope and scope.is_scoped:
                ev = message.get("event") or {}
                person_id = ev.get("person_id") or message.get("person_id")
                camera_id = ev.get("camera_id") or message.get("camera_id")

                if is_supervisor:
                    if person_id is not None:
                        if not scope.can_access_person(person_id):
                            continue
                    else:
                        if camera_id is not None and not scope.can_access_camera(camera_id):
                            continue
                        if message.get("type") == "new_event" and not ev.get("is_known"):
                            continue

            # Redact snapshot image paths for supervisors (Zero-Photo privacy)
            client_msg = message
            if is_supervisor:
                client_msg = json.loads(json.dumps(message, default=str))
                if "event" in client_msg and isinstance(client_msg["event"], dict):
                    client_msg["event"]["snapshot_url"] = ""
                    client_msg["event"]["snapshot_path"] = ""

            payload = json.dumps(client_msg, default=str)
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(client)

        for client in stale:
            self.disconnect(client.ws)


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
        self._persons_shift_cache: dict[int, dict] = {}  # person_id -> supervisor shift & leaves info
        self._shift_templates_cache: dict[int, dict] = {}  # template_id -> template config dict
        self._zone_last_seen: dict[tuple[int, int], float] = {}  # (zone_id, person_id) -> timestamp
        self._zone_last_absence_alert: dict[tuple[int, int], float] = {}  # (zone_id, person_id) -> timestamp
        self._camera_last_disconnect_alert: dict[int, float] = {}  # camera_id -> timestamp of last disconnect alert
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

        # Clear zones cache and offline alert state for this camera
        async with self._cache_lock:
            self._zones_cache.pop(camera_id, None)
            self._camera_last_disconnect_alert.pop(camera_id, None)
            # Remove any cooldown keys for this camera
            to_del_cd = [k for k in self._cooldown_cache if k[0] == camera_id]
            for k in to_del_cd:
                self._cooldown_cache.pop(k, None)
            # Clean up tracking for any deleted zones
            active_zone_ids = {z["id"] for zlist in self._zones_cache.values() for z in zlist}
            for k in list(self._zone_last_seen.keys()):
                if k[0] not in active_zone_ids:
                    self._zone_last_seen.pop(k, None)
            for k in list(self._zone_last_absence_alert.keys()):
                if k[0] not in active_zone_ids:
                    self._zone_last_absence_alert.pop(k, None)

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
                all_cams = cams_result.scalars().all()
                active_cam_ids = {c.id for c in all_cams if c.is_active}
                self._camera_names = {c.id: c.name for c in all_cams if c.is_active}

                result = await session.execute(
                    select(CameraZone).where(CameraZone.is_active == True)  # noqa: E712
                )
                zones = result.scalars().all()

                for z in zones:
                    # Ignore zones for deleted or deactivated cameras
                    if z.camera_id not in active_cam_ids:
                        continue

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
                        "absence_timeout_minutes": getattr(z, "absence_timeout_minutes", 2) or 2,
                        "grace_period_minutes": getattr(z, "grace_period_minutes", 10) or 10,
                        "free_times": z.free_times or [],
                        "shift_name": getattr(z, "shift_name", "") or "",
                        "shifts": getattr(z, "shifts", []) or [],
                    })

                # Check and populate last seen from database for any newly loaded assigned person
                # so that server restart preserves true detection history
                for z in zones:
                    if z.camera_id not in active_cam_ids:
                        continue
                    assigned = z.assigned_person_ids or []
                    for pid in assigned:
                        try:
                            pid_int = int(pid)
                        except Exception:
                            continue
                        pair_key = (z.id, pid_int)
                        if pair_key not in self._zone_last_seen:
                            # Look up most recent presence event for this person in this zone
                            evt_res = await session.execute(
                                select(Event.timestamp)
                                .where(
                                    Event.zone_id == z.id,
                                    Event.person_id == pid_int,
                                    ~Event.alert_type.in_(["absence_timeout", "camera_disconnected"]),
                                )
                                .order_by(Event.timestamp.desc())
                                .limit(1)
                            )
                            last_ts_dt = evt_res.scalars().first()
                            if last_ts_dt:
                                if last_ts_dt.tzinfo is None:
                                    last_ts_dt = last_ts_dt.replace(tzinfo=timezone.utc)
                                self._zone_last_seen[pair_key] = last_ts_dt.timestamp()
                            else:
                                self._zone_last_seen[pair_key] = 0.0

                # Cache ShiftTemplates for quick watchdog and schedule lookup
                tmpl_res = await session.execute(select(ShiftTemplate))
                templates = tmpl_res.scalars().all()
                self._shift_templates_cache = {
                    t.id: {
                        "id": t.id,
                        "name": t.name,
                        "shift_type": getattr(t, "shift_type", "fixed") or "fixed",
                        "start_time": t.start_time or "08:00",
                        "end_time": t.end_time or "17:00",
                        "active_days": t.active_days or ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"],
                        "grace_period_minutes": getattr(t, "grace_period_minutes", 10) or 10,
                        "absence_timeout_minutes": getattr(t, "absence_timeout_minutes", 2) or 2,
                        "free_times": t.free_times or [],
                        "rotation_pattern": getattr(t, "rotation_pattern", None),
                    }
                    for t in templates
                }

                # Cache Persons' supervisor shift configurations and leaves
                p_res = await session.execute(select(Person))
                persons = p_res.scalars().all()
                self._persons_shift_cache = {
                    p.id: {
                        "id": p.id,
                        "name": p.name,
                        "custom_shift": p.custom_shift if isinstance(p.custom_shift, dict) else None,
                        "shift_template_id": p.shift_template_id,
                        "leaves": p.leaves if isinstance(p.leaves, list) else [],
                    }
                    for p in persons
                }

            self._zones_cache = zones_map
            # Clean up tracking for any zones that no longer exist
            active_zone_ids = {z["id"] for zlist in zones_map.values() for z in zlist}
            for k in list(self._zone_last_seen.keys()):
                if k[0] not in active_zone_ids:
                    self._zone_last_seen.pop(k, None)
            for k in list(self._zone_last_absence_alert.keys()):
                if k[0] not in active_zone_ids:
                    self._zone_last_absence_alert.pop(k, None)
            logger.info("Refreshed camera zones cache: %d active cameras with configured zones.", len(zones_map))

    @staticmethod
    def _is_zone_in_schedule(start_time: str, end_time: str, active_days: list[str]) -> bool:
        """Check if current time is within active shift hours and days (supports overnight cross-midnight shifts)."""
        return is_time_in_timetable(start_time, end_time, active_days)

    @staticmethod
    def _is_time_in_free_time(free_times: list) -> tuple[bool, str]:
        """Check if current time is within any defined free/break time (lunch, rest, etc.)."""
        in_free, name = is_time_in_free_time(free_times)
        return in_free, name or ""

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
                now_local = _to_local_dt(datetime.now(timezone.utc))
                today_str = now_local.strftime("%Y-%m-%d")
                async with self._cache_lock:
                    zones_snapshot = list(self._zones_cache.items())
                    known_persons_map = {kp.person_id: kp.person_name for kp in self._known_persons_cache}
                    persons_shift_map = dict(self._persons_shift_cache)
                    templates_map = dict(self._shift_templates_cache)

                for camera_id, zones in zones_snapshot:
                    # Defensive checks: ignore deleted, deactivated, or stopped cameras
                    if camera_id not in self._camera_names:
                        continue
                    if camera_id not in self._threads or (camera_id in self._stop_events and self._stop_events[camera_id].is_set()):
                        continue

                    is_cam_online = self.is_camera_online(camera_id)
                    camera_name = self._camera_names.get(camera_id, f"Camera #{camera_id}")

                    for zone in zones:
                        mode = zone.get("alert_mode", "absence")
                        if mode not in ("absence", "both", "out_of_zone"):
                            continue

                        # Default fallback settings from the physical workstation (CameraZone)
                        z_start = zone.get("start_time", "00:00") or "00:00"
                        z_end = zone.get("end_time", "23:59") or "23:59"
                        z_days = zone.get("active_days") or ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                        z_timeout = zone.get("absence_timeout_minutes", 2) or 2
                        z_grace = zone.get("grace_period_minutes", 10) or 10
                        z_free = zone.get("free_times") or []
                        zone_shifts = zone.get("shifts") or []

                        # Gather all assigned persons
                        assigned_pids_set = set()
                        for x in (zone.get("assigned_person_ids") or []):
                            try:
                                assigned_pids_set.add(int(x))
                            except Exception:
                                pass
                        for s in zone_shifts:
                            for x in (s.get("assigned_person_ids") or []):
                                try:
                                    assigned_pids_set.add(int(x))
                                except Exception:
                                    pass

                        for person_id in assigned_pids_set:
                            person_name = known_persons_map.get(person_id, f"Person #{person_id}")
                            person_cfg = persons_shift_map.get(person_id, {})

                            p_custom = person_cfg.get("custom_shift")
                            p_tmpl_id = person_cfg.get("shift_template_id")
                            p_leaves = person_cfg.get("leaves", [])

                            # Check approved leaves/days off first
                            is_on_leave = False
                            for l in p_leaves:
                                if isinstance(l, dict):
                                    s_date = str(l.get("start_date", "")).strip()
                                    e_date = str(l.get("end_date", "")).strip() or s_date
                                    if s_date <= today_str <= e_date:
                                        is_on_leave = True
                                        break
                            if is_on_leave:
                                continue  # On leave — suppress absence alert

                            # Resolve shift timing set by supervisor
                            cur_shift_start_dt = None
                            cur_shift_end_dt = None
                            cur_in_schedule = False
                            cur_is_overnight = False
                            cur_dur_h = 8.0
                            cur_elapsed_shift_mins = 0
                            cur_grace = z_grace
                            cur_timeout = z_timeout
                            person_breaks = []
                            rot_state = None

                            if p_custom and isinstance(p_custom, dict):
                                shift_kind = p_custom.get("shift_type", "fixed")
                                rot_pattern = p_custom.get("rotation_pattern") if shift_kind in ("rotational", "rotation") else None
                                if rot_pattern and isinstance(rot_pattern, dict):
                                    rot_state = get_rotation_day_state(rot_pattern, now_local)
                                    cur_in_schedule = rot_state.get("is_active_now", False)
                                    cur_is_overnight = rot_state.get("is_overnight", False)
                                    cur_elapsed_shift_mins = rot_state.get("elapsed_minutes", 0)
                                    cur_shift_start_dt = rot_state.get("shift_start")
                                    cur_shift_end_dt = rot_state.get("shift_end")
                                else:
                                    p_start = str(p_custom.get("start_time") or "08:00").strip()
                                    p_end = str(p_custom.get("end_time") or "17:00").strip()
                                    p_days = p_custom.get("active_days") or ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"]
                                    cur_in_schedule, cur_shift_start_dt, cur_shift_end_dt, cur_is_overnight, cur_dur_h, cur_elapsed_shift_mins = get_shift_window(
                                        p_start, p_end, p_days, now_local
                                    )
                                if p_custom.get("grace_period_minutes") is not None:
                                    cur_grace = int(p_custom["grace_period_minutes"])
                                if p_custom.get("absence_timeout_minutes") is not None:
                                    cur_timeout = int(p_custom["absence_timeout_minutes"])
                                person_breaks = p_custom.get("free_times") or []

                            elif p_tmpl_id and p_tmpl_id in templates_map:
                                st = templates_map[p_tmpl_id]
                                if st.get("shift_type") in ("rotational", "rotation") and st.get("rotation_pattern"):
                                    rot_pattern = st.get("rotation_pattern")
                                    rot_state = get_rotation_day_state(rot_pattern, now_local)
                                    cur_in_schedule = rot_state.get("is_active_now", False)
                                    cur_is_overnight = rot_state.get("is_overnight", False)
                                    cur_elapsed_shift_mins = rot_state.get("elapsed_minutes", 0)
                                    cur_shift_start_dt = rot_state.get("shift_start")
                                    cur_shift_end_dt = rot_state.get("shift_end")
                                else:
                                    p_start = str(st.get("start_time") or "08:00").strip()
                                    p_end = str(st.get("end_time") or "17:00").strip()
                                    p_days = st.get("active_days") or ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"]
                                    cur_in_schedule, cur_shift_start_dt, cur_shift_end_dt, cur_is_overnight, cur_dur_h, cur_elapsed_shift_mins = get_shift_window(
                                        p_start, p_end, p_days, now_local
                                    )
                                if st.get("grace_period_minutes") is not None:
                                    cur_grace = int(st["grace_period_minutes"])
                                if st.get("absence_timeout_minutes") is not None:
                                    cur_timeout = int(st["absence_timeout_minutes"])
                                person_breaks = st.get("free_times") or []

                            else:
                                # Check if zone has sub-shifts that match this person, or use zone default
                                s_matched = None
                                if zone_shifts:
                                    for s in zone_shifts:
                                        s_pids = [int(px) for px in (s.get("assigned_person_ids") or []) if str(px).isdigit()]
                                        if person_id in s_pids:
                                            s_matched = s
                                            break
                                if s_matched:
                                    s_start = s_matched.get("start_time") or z_start
                                    s_end = s_matched.get("end_time") or z_end
                                    s_days = s_matched.get("active_days") or z_days
                                    cur_in_schedule, cur_shift_start_dt, cur_shift_end_dt, cur_is_overnight, cur_dur_h, cur_elapsed_shift_mins = get_shift_window(
                                        s_start, s_end, s_days, now_local
                                    )
                                    cur_grace = s_matched.get("grace_period_minutes") if s_matched.get("grace_period_minutes") is not None else z_grace
                                    cur_timeout = s_matched.get("absence_timeout_minutes") or z_timeout
                                    person_breaks = s_matched.get("free_times") or []
                                else:
                                    cur_in_schedule, cur_shift_start_dt, cur_shift_end_dt, cur_is_overnight, cur_dur_h, cur_elapsed_shift_mins = get_shift_window(
                                        z_start, z_end, z_days, now_local
                                    )

                            if not cur_in_schedule or (rot_state and rot_state.get("shift_kind") == "off"):
                                continue  # Off duty according to supervisor's schedule — suppress alerts

                            # Check scheduled breaks (both zone breaks and person's shift breaks)
                            combined_breaks = list(z_free) + list(person_breaks)
                            in_break, _ = is_time_in_free_time(combined_breaks, now_local)
                            if in_break:
                                continue  # On scheduled break — suppress alerts

                            timeout_mins = cur_timeout
                            timeout_secs = float(timeout_mins * 60)
                            grace_mins = cur_grace
                            shift_start_ts = cur_shift_start_dt.timestamp() if cur_shift_start_dt else 0

                            # If camera is NOT online/connected:
                            if not is_cam_online:
                                if (
                                    camera_id not in self._threads
                                    or camera_id not in self._camera_names
                                    or (camera_id in self._stop_events and self._stop_events[camera_id].is_set())
                                ):
                                    continue

                                # Log camera disconnected alert (throttled to once per 5 minutes per camera)
                                # AND CRITICALLY: DO NOT LOG ABSENCE and DO NOT fake last_seen to now!
                                last_disc = self._camera_last_disconnect_alert.get(camera_id, 0)
                                if (now - last_disc) >= 300.0:
                                    self._camera_last_disconnect_alert[camera_id] = now
                                    disc_message = (
                                        f"⚠️ Camera Disconnected: '{camera_name}' is offline. "
                                        f"Presence monitoring suspended for {person_name} in '{zone.get('name')}'."
                                    )
                                    logger.warning(disc_message)

                                    saved_event_id = None
                                    saved_snapshot = ""
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
                                                confidence_score=0.0,
                                                snapshot_path=saved_snapshot,
                                                is_known=True,
                                                zone_id=zone["id"],
                                                zone_name=zone["name"],
                                                alert_type="camera_disconnected",
                                                duration_seconds=0,
                                            )
                                            session.add(evt)
                                            await session.commit()
                                            await session.refresh(evt)
                                            saved_event_id = evt.id
                                    except Exception as db_err:
                                        logger.error("Failed to log camera disconnected event to DB: %s", db_err)

                                    await ws_manager.broadcast({
                                        "type": "zone_alert",
                                        "alert_type": "camera_disconnected",
                                        "message": disc_message,
                                        "event": {
                                            "id": saved_event_id or int(time.time()),
                                            "timestamp": datetime.now(timezone.utc).isoformat(),
                                            "camera_id": camera_id,
                                            "camera_name": camera_name,
                                            "person_id": person_id,
                                            "person_name": person_name,
                                            "confidence_score": 0.0,
                                            "snapshot_url": f"/api/snapshots/{saved_snapshot}" if saved_snapshot else "",
                                            "snapshot_path": saved_snapshot,
                                            "is_known": True,
                                            "zone_id": zone["id"],
                                            "zone_name": zone["name"],
                                            "alert_type": "camera_disconnected",
                                            "duration_seconds": 0,
                                            "duration_str": "Camera Disconnected",
                                        },
                                        "zone_id": zone["id"],
                                        "zone_name": zone["name"],
                                        "camera_id": camera_id,
                                        "camera_name": camera_name,
                                        "person_id": person_id,
                                        "person_name": person_name,
                                    })
                                # Skip absence check when camera is offline (without modifying _zone_last_seen)
                                continue

                            # Camera is online — clear any offline alert throttle
                            if camera_id in self._camera_last_disconnect_alert:
                                self._camera_last_disconnect_alert.pop(camera_id, None)

                            key = (zone["id"], person_id)
                            last_seen = self._zone_last_seen.get(key, 0)
                            seen_in_shift = (last_seen > 0) and (last_seen >= shift_start_ts)

                            if seen_in_shift:
                                absent_duration_secs = int(now - last_seen)
                                if absent_duration_secs < timeout_secs:
                                    continue  # Person is currently present or within timeout threshold
                                minutes_absent = max(1, absent_duration_secs // 60)
                                time_desc = f"{minutes_absent} min" if minutes_absent == 1 else f"{minutes_absent} mins"
                                alert_msg = (
                                    f"⚠️ Absence Alert: {person_name} is NOT in assigned area "
                                    f"'{zone['name']}' (missing for {time_desc}, threshold: {timeout_mins}m)"
                                )
                            else:
                                # Person was never seen in this shift
                                if cur_elapsed_shift_mins < grace_mins:
                                    # Within arrival grace period — suppress absence alert
                                    continue
                                absent_duration_secs = max(int(now - shift_start_ts), int(timeout_secs))
                                minutes_absent = max(1, absent_duration_secs // 60)
                                time_desc = f"{minutes_absent} min" if minutes_absent == 1 else f"{minutes_absent} mins"
                                alert_msg = (
                                    f"⚠️ Absence Alert: {person_name} has NOT arrived for shift in "
                                    f"'{zone['name']}' (shift started {time_desc} ago, threshold: {timeout_mins}m)"
                                )

                            last_alert = self._zone_last_absence_alert.get(key, 0)
                            throttle_interval = max(120.0, float(timeout_secs))
                            if (now - last_alert) >= throttle_interval:
                                self._zone_last_absence_alert[key] = now
                                logger.warning(alert_msg)

                                saved_event_id = None
                                saved_snapshot = ""
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
                                            confidence_score=0.0,
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
                                    "message": alert_msg,
                                    "event": {
                                        "id": saved_event_id or int(time.time()),
                                        "timestamp": datetime.now(timezone.utc).isoformat(),
                                        "camera_id": camera_id,
                                        "camera_name": camera_name,
                                        "person_id": person_id,
                                        "person_name": person_name,
                                        "confidence_score": 0.0,
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
                if stop_event.is_set():
                    self._camera_connected.pop(camera_id, None)
                else:
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

        if camera_id not in self._threads or (camera_id in self._stop_events and self._stop_events[camera_id].is_set()):
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
                        # Skip if currently in scheduled free time / break
                        if self._is_time_in_free_time(zone.get("free_times", []))[0]:
                            continue
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
