"""
Camera Zone / Important Area management API router.

Endpoints:
  GET    /api/cameras/{camera_id}/zones — List zones for a camera
  POST   /api/cameras/{camera_id}/zones — Create a new zone on a camera
  GET    /api/zones                     — List all zones across cameras
  GET    /api/zones/status              — Real-time presence & timetable status board
  GET    /api/zones/logs                — Audit log of zone alerts and violations
  GET    /api/zones/{zone_id}           — Get details for a zone
  PUT    /api/zones/{zone_id}           — Update a zone
  DELETE /api/zones/{zone_id}           — Remove a zone
"""

import json
import time
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status, Response
from sqlalchemy import select, desc, or_, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import require_permission, get_user_scope
from backend.database import get_db
from backend.models import Camera, CameraZone, Person, Event, PersonEmbedding, ShiftTemplate, User
from backend.reporting import generate_duty_roster_xlsx, generate_duty_roster_csv
from backend.shift_utils import get_rotation_day_state, get_interval_free_minutes
from backend.schemas import (
    CameraZoneCreate,
    CameraZoneUpdate,
    CameraZoneResponse,
    ShiftTemplateCreate,
    ShiftTemplateUpdate,
    ShiftTemplateResponse,
    ZoneStatusResponse,
    ZonePersonStatus,
    PersonDutyStatus,
    AbsenceInterval,
    DutyRosterResponse,
    EventResponse,
    EventListResponse,
)
from backend.stream_processor import stream_processor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["zones"])


def _to_local_dt(dt: datetime) -> datetime:
    """Convert UTC or naive datetime to local timezone datetime (naive representation for direct comparisons)."""
    if dt is None:
        return datetime.now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().replace(tzinfo=None)


def _format_duration(seconds: int) -> str:
    """Format duration in seconds to a human-readable string."""
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    rem_mins = minutes % 60
    return f"{hours}h {rem_mins}m" if rem_mins > 0 else f"{hours}h"



def _parse_list_field(val: Any, default: list) -> list:
    """Safely parse a database field into a Python list."""
    if val is None:
        return default
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    return default


def get_shift_window(
    start_time: Any,
    end_time: Any,
    active_days: Any,
    ref_dt: Optional[datetime] = None,
) -> tuple[bool, datetime, datetime, bool, float, int]:
    """
    Calculate active status and exact local start & end datetimes for a shift,
    with full support for overnight / midnight-crossing shifts.

    Returns:
      (is_active_now, shift_start_dt, shift_end_dt, is_overnight, shift_duration_hours, elapsed_minutes)
    """
    if ref_dt is None:
        ref_dt = datetime.now()

    days_list = _parse_list_field(active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    start_str = str(start_time).strip() if start_time else "00:00"
    end_str = str(end_time).strip() if end_time else "23:59"

    try:
        sh, sm = map(int, start_str.split(":"))
    except Exception:
        sh, sm = 0, 0
    try:
        eh, em = map(int, end_str.split(":"))
    except Exception:
        eh, em = 23, 59

    start_mins = sh * 60 + sm
    end_mins = eh * 60 + em
    is_overnight = start_mins > end_mins
    ref_hm_mins = ref_dt.hour * 60 + ref_dt.minute

    if not is_overnight:
        # Standard intra-day shift (e.g. 08:00 - 17:00 or 00:00 - 23:59)
        day_name = ref_dt.strftime("%a")
        shift_start = ref_dt.replace(hour=sh, minute=sm, second=0, microsecond=0)
        shift_end = ref_dt.replace(hour=eh, minute=em, second=0, microsecond=0)
        total_duration_hours = max(0.1, round((shift_end - shift_start).total_seconds() / 3600.0, 1))

        is_active = (day_name in days_list) and (shift_start <= ref_dt <= shift_end)
        if is_active:
            elapsed_minutes = max(0, int((ref_dt - shift_start).total_seconds() // 60))
        else:
            elapsed_minutes = 0

        return is_active, shift_start, shift_end, False, total_duration_hours, elapsed_minutes

    else:
        # Cross-midnight overnight shift (e.g. 22:00 - 06:00)
        total_shift_mins = (24 * 60 - start_mins) + end_mins
        total_duration_hours = max(0.1, round(total_shift_mins / 60.0, 1))

        if ref_hm_mins >= start_mins:
            # Shift started today (before midnight) and will end tomorrow morning
            origin_day_name = ref_dt.strftime("%a")
            shift_start = ref_dt.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_end = (ref_dt + timedelta(days=1)).replace(hour=eh, minute=em, second=0, microsecond=0)
            is_active = origin_day_name in days_list
            elapsed_minutes = max(0, int((ref_dt - shift_start).total_seconds() // 60)) if is_active else 0
            return is_active, shift_start, shift_end, True, total_duration_hours, elapsed_minutes

        elif ref_hm_mins <= end_mins:
            # Shift started yesterday (before midnight) and ends today morning
            yesterday = ref_dt - timedelta(days=1)
            origin_day_name = yesterday.strftime("%a")
            shift_start = yesterday.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_end = ref_dt.replace(hour=eh, minute=em, second=0, microsecond=0)
            is_active = origin_day_name in days_list
            elapsed_minutes = max(0, int((ref_dt - shift_start).total_seconds() // 60)) if is_active else 0
            return is_active, shift_start, shift_end, True, total_duration_hours, elapsed_minutes

        else:
            # Outside active shift hours (e.g. 14:00 when shift is 22:00 - 06:00)
            yesterday = ref_dt - timedelta(days=1)
            shift_start = yesterday.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_end = ref_dt.replace(hour=eh, minute=em, second=0, microsecond=0)
            return False, shift_start, shift_end, True, total_duration_hours, 0


def is_time_in_timetable(
    start_time: Any,
    end_time: Any,
    active_days: Any,
    current_dt: Optional[datetime] = None,
) -> bool:
    """Check if the current local time and day falls within a timetable."""
    is_active, _, _, _, _, _ = get_shift_window(start_time, end_time, active_days, current_dt)
    return is_active


def is_time_in_free_time(
    free_times: Any,
    current_dt: Optional[datetime] = None,
) -> tuple[bool, Optional[str]]:
    """Check if current local time falls within any defined free/break time interval (lunch, tea, rest)."""
    parsed_breaks = _parse_list_field(free_times, [])
    if not parsed_breaks:
        return False, None
    if current_dt is None:
        current_dt = datetime.now()
    now_hm_mins = current_dt.hour * 60 + current_dt.minute

    for b in parsed_breaks:
        if not isinstance(b, dict):
            continue
        start_str = str(b.get("start_time") or "00:00")
        end_str = str(b.get("end_time") or "00:00")
        name = str(b.get("name") or "Break")
        try:
            sh, sm = map(int, start_str.split(":"))
            eh, em = map(int, end_str.split(":"))
            s_mins = sh * 60 + sm
            e_mins = eh * 60 + em
        except Exception:
            continue

        if s_mins <= e_mins:
            if s_mins <= now_hm_mins <= e_mins:
                return True, name
        else:
            # Overnight break interval
            if now_hm_mins >= s_mins or now_hm_mins <= e_mins:
                return True, name
    return False, None


# ── Camera-Scoped Endpoints ──────────────────────────────

@router.get("/api/cameras/{camera_id}/zones", response_model=list[CameraZoneResponse])
async def list_camera_zones(
    camera_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("zones:view")),
):
    """List all important areas/zones defined on a specific camera."""
    scope = await get_user_scope(_user, db)
    if scope.is_scoped and not scope.can_access_camera(camera_id):
        raise HTTPException(status_code=403, detail="دسترسی به این دوربین برای شما مجاز نیست.")

    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    result = await db.execute(
        select(CameraZone)
        .where(CameraZone.camera_id == camera_id)
        .order_by(CameraZone.created_at.asc())
    )
    return result.scalars().all()


@router.post("/api/cameras/{camera_id}/zones", response_model=CameraZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_camera_zone(
    camera_id: int,
    data: CameraZoneCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("zones:create")),
):
    """Create a new important area/zone on a camera with timetable, free times, and assigned persons."""
    scope = await get_user_scope(_user, db)
    if scope.is_scoped and not scope.can_access_camera(camera_id):
        raise HTTPException(status_code=403, detail="ایجاد منطقه روی این دوربین برای شما مجاز نیست.")

    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    zone = CameraZone(
        camera_id=camera_id,
        name=data.name,
        x=data.x,
        y=data.y,
        width=data.width,
        height=data.height,
        alert_mode=data.alert_mode or "absence",
        assigned_person_ids=data.assigned_person_ids or [],
        start_time=data.start_time or "00:00",
        end_time=data.end_time or "23:59",
        active_days=data.active_days or ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        absence_timeout_minutes=data.absence_timeout_minutes if data.absence_timeout_minutes is not None else 2,
        grace_period_minutes=data.grace_period_minutes if data.grace_period_minutes is not None else 10,
        free_times=data.free_times or [],
        shift_name=data.shift_name or "",
        shifts=data.shifts or [],
        is_active=data.is_active,
    )
    db.add(zone)
    await db.commit()
    await db.refresh(zone)

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    logger.info("Camera zone created: id=%d camera_id=%d name='%s'", zone.id, camera_id, zone.name)
    return zone


# ── Live Status & Audit Logs ─────────────────────────────

@router.get("/api/zones/status", response_model=list[ZoneStatusResponse])
async def get_zones_status(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("zones:view")),
):
    """
    Get the real-time presence status board for all configured camera zones.
    Shows whether assigned persons are currently in their zones, absent, or off-duty.
    """
    scope = await get_user_scope(_user, db)
    query = select(CameraZone).order_by(CameraZone.created_at.asc())
    if scope.is_scoped and scope.camera_ids is not None:
        query = query.where(CameraZone.camera_id.in_(scope.camera_ids))
    zones_result = await db.execute(query)
    zones = zones_result.scalars().all()

    cameras_result = await db.execute(select(Camera))
    camera_map = {c.id: c.name for c in cameras_result.scalars().all()}

    persons_result = await db.execute(select(Person))
    person_map = {p.id: p.name for p in persons_result.scalars().all()}

    now = time.time()
    response_list: list[ZoneStatusResponse] = []

    for z in zones:
        camera_name = camera_map.get(z.camera_id, f"Camera #{z.camera_id}")
        active_days = _parse_list_field(z.active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])

        now_dt = datetime.now()
        in_schedule, shift_start_dt, shift_end_dt, is_overnight, dur_h, elapsed_shift_mins = get_shift_window(
            z.start_time or "00:00",
            z.end_time or "23:59",
            active_days,
            now_dt,
        )

        in_free_time, break_name = is_time_in_free_time(z.free_times, now_dt)

        days_str = ",".join(str(d) for d in active_days) if active_days else "All Days"
        timetable_text = f"{z.start_time or '00:00'} - {z.end_time or '23:59'} ({days_str})"

        assigned_status_list: list[ZonePersonStatus] = []
        raw_assigned = _parse_list_field(z.assigned_person_ids, [])
        assigned_ids = [int(x) for x in raw_assigned if str(x).isdigit()]
        is_cam_online = stream_processor.is_camera_online(z.camera_id)
        shift_start_ts = shift_start_dt.timestamp()

        for pid in assigned_ids:
            pname = person_map.get(pid, f"Person #{pid}")
            key = (z.id, pid)
            last_seen = stream_processor._zone_last_seen.get(key, 0)
            seen_in_shift = (last_seen > 0) and (last_seen >= shift_start_ts)

            z_timeout = getattr(z, "absence_timeout_minutes", 2) or 2
            z_timeout_secs = float(z_timeout * 60)
            z_grace = getattr(z, "grace_period_minutes", 10) or 10

            if not in_schedule:
                status_str = "off_duty"
                last_seen_sec = None
                last_seen_str = "Off Duty (Outside Timetable)"
                minutes_absent = None
            elif not is_cam_online:
                status_str = "camera_offline"
                last_seen_sec = None
                last_seen_str = "Camera Disconnected"
                minutes_absent = None
            elif in_free_time:
                # During Free Times & Breaks: Never absent, 0 absence minutes
                if seen_in_shift and (now - last_seen) < z_timeout_secs:
                    status_str = "present"
                    last_seen_sec = round(now - last_seen, 1)
                    last_seen_str = f"In Zone (seen {int(last_seen_sec)}s ago)" if last_seen_sec < 60 else f"In Zone (seen {int(last_seen_sec // 60)}m ago)"
                    minutes_absent = 0
                else:
                    status_str = "on_break"
                    last_seen_sec = round(now - last_seen, 1) if seen_in_shift else None
                    last_seen_str = f"On Break ({break_name})"
                    minutes_absent = 0
            elif seen_in_shift and (now - last_seen) < z_timeout_secs:
                # Missing for less than Absence Alarm Grace Timer: Present, 0 absence minutes!
                status_str = "present"
                last_seen_sec = round(now - last_seen, 1)
                last_seen_str = f"In Zone (seen {int(last_seen_sec)}s ago)" if last_seen_sec < 60 else f"In Zone (seen {int(last_seen_sec // 60)}m ago)"
                minutes_absent = 0
            elif not seen_in_shift and elapsed_shift_mins <= z_grace:
                # Within Arrival Grace Period: Present / in grace, 0 absence minutes!
                status_str = "present"
                last_seen_sec = None
                last_seen_str = f"Arrival Grace Period ({elapsed_shift_mins}/{z_grace}m)"
                minutes_absent = 0
            else:
                # Exceeded threshold or arrival grace
                if seen_in_shift:
                    last_seen_sec = round(now - last_seen, 1)
                    raw_mins = max(1, int(last_seen_sec // 60))
                    last_dt = datetime.fromtimestamp(last_seen)
                    free_mins_since = get_interval_free_minutes(last_dt, now_dt, z.free_times or [])
                    net_mins = max(0, raw_mins - free_mins_since)
                    if net_mins < z_timeout:
                        status_str = "present"
                        last_seen_str = f"In Zone (seen {raw_mins}m ago)"
                        minutes_absent = 0
                    else:
                        status_str = "absent"
                        last_seen_str = f"Missing for {net_mins}m"
                        minutes_absent = net_mins
                else:
                    status_str = "absent"
                    last_seen_sec = None
                    last_seen_str = "Not Seen Yet"
                    free_since_start = get_interval_free_minutes(shift_start_dt, now_dt, z.free_times or [])
                    minutes_absent = max(1, elapsed_shift_mins - free_since_start) if elapsed_shift_mins > 0 else 0

            assigned_status_list.append(
                ZonePersonStatus(
                    person_id=pid,
                    person_name=pname,
                    status=status_str,
                    last_seen_seconds_ago=last_seen_sec,
                    last_seen_str=last_seen_str,
                    minutes_absent=minutes_absent,
                )
            )

        response_list.append(
            ZoneStatusResponse(
                zone_id=z.id,
                zone_name=z.name,
                camera_id=z.camera_id,
                camera_name=camera_name,
                is_in_schedule=in_schedule,
                timetable_text=timetable_text,
                alert_mode=z.alert_mode or "absence",
                absence_timeout_minutes=getattr(z, "absence_timeout_minutes", 2) or 2,
                free_times=_parse_list_field(z.free_times, []),
                is_in_free_time=in_free_time,
                current_break_name=break_name,
                assigned_persons=assigned_status_list,
            )
        )

    return response_list


async def compute_duty_roster_data(
    db: AsyncSession,
    only_active: bool = True,
) -> DutyRosterResponse:
    """
    Compute real-time duty roster monitoring metrics and status for today.
    """
    now_ts = time.time()
    now_local = datetime.now()
    events_start_utc = datetime.now(timezone.utc) - timedelta(hours=36)
    current_hm_mins = now_local.hour * 60 + now_local.minute

    # 1. Fetch active zones
    zones_result = await db.execute(
        select(CameraZone).where(CameraZone.is_active == True).order_by(CameraZone.created_at.asc())
    )
    zones = zones_result.scalars().all()

    # 2. Camera map
    cameras_result = await db.execute(select(Camera))
    camera_map = {c.id: c.name for c in cameras_result.scalars().all()}

    # 3. Person map
    persons_result = await db.execute(select(Person))
    persons = {p.id: p for p in persons_result.scalars().all()}

    # 3b. Shift templates map for rotational shifts
    st_res = await db.execute(select(ShiftTemplate))
    shift_templates_map = {st.id: st for st in st_res.scalars().all()}

    # 4. Avatar map
    emb_result = await db.execute(select(PersonEmbedding))
    embeddings = emb_result.scalars().all()
    avatar_map: dict[int, str] = {}
    for e in embeddings:
        if e.person_id not in avatar_map and e.reference_photo_path:
            avatar_map[e.person_id] = f"/api/snapshots/ref_{Path(e.reference_photo_path).name}"

    # 5. Events from past 36 hours (ensures cross-midnight overnight shift events are included)
    events_result = await db.execute(
        select(Event)
        .where(Event.timestamp >= events_start_utc)
        .order_by(Event.timestamp.asc())
    )
    recent_events = events_result.scalars().all()

    roster: list[PersonDutyStatus] = []

    for z in zones:
        camera_name = camera_map.get(z.camera_id, f"Camera #{z.camera_id}")

        # Check if zone defines multiple rotational shifts or a single shift
        zone_shifts = _parse_list_field(z.shifts, [])
        if not zone_shifts:
            sub_shifts = [{
                "name": getattr(z, "shift_name", "") or "",
                "start_time": z.start_time or "00:00",
                "end_time": z.end_time or "23:59",
                "active_days": _parse_list_field(z.active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
                "assigned_person_ids": _parse_list_field(z.assigned_person_ids, []),
                "absence_timeout_minutes": getattr(z, "absence_timeout_minutes", 2) or 2,
                "grace_period_minutes": getattr(z, "grace_period_minutes", 10) or 10,
                "free_times": _parse_list_field(z.free_times, []),
            }]
        else:
            sub_shifts = zone_shifts

        for s in sub_shifts:
            start_str = str(s.get("start_time") or z.start_time or "00:00").strip()
            end_str = str(s.get("end_time") or z.end_time or "23:59").strip()
            s_days = _parse_list_field(s.get("active_days", z.active_days), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
            s_name = s.get("name") or getattr(z, "shift_name", "") or ""
            s_grace = s.get("grace_period_minutes") if s.get("grace_period_minutes") is not None else (getattr(z, "grace_period_minutes", 10) or 10)
            s_timeout = s.get("absence_timeout_minutes") if s.get("absence_timeout_minutes") is not None else (getattr(z, "absence_timeout_minutes", 2) or 2)
            s_free = _parse_list_field(s.get("free_times", z.free_times), [])

            in_schedule, shift_start_dt, shift_end_dt, is_overnight, dur_h, elapsed_shift_mins = get_shift_window(
                start_str, end_str, s_days, now_local
            )

            shift_window_str = f"{start_str} - {end_str}"
            in_free_time, break_name = is_time_in_free_time(s_free, now_local)

            raw_assigned = _parse_list_field(s.get("assigned_person_ids", z.assigned_person_ids), [])
            assigned_ids = [int(x) for x in raw_assigned if str(x).isdigit()]

            for pid in assigned_ids:
                person = persons.get(pid)
                person_name = person.name if person else f"Person #{pid}"
                person_role = person.role if person else None
                avatar_url = avatar_map.get(pid)

                # Resolve shift for this person: supervisor shift (custom or template) overrides zone defaults
                cur_in_schedule = in_schedule
                cur_shift_start_dt = shift_start_dt
                cur_shift_end_dt = shift_end_dt
                cur_start_str = start_str
                cur_end_str = end_str
                cur_shift_window_str = shift_window_str
                cur_dur_h = dur_h
                cur_elapsed_shift_mins = elapsed_shift_mins
                cur_shift_name = s_name
                cur_is_overnight = is_overnight
                cur_grace = s_grace
                cur_timeout = s_timeout
                cur_days = s_days
                person_breaks = []
                rot_state = None

                if person:
                    # 1. Custom shift set directly by supervisor
                    if person.custom_shift and isinstance(person.custom_shift, dict):
                        cs = person.custom_shift
                        shift_kind = cs.get("shift_type", "fixed")
                        rot_pattern = cs.get("rotation_pattern") if shift_kind in ("rotational", "rotation") else None

                        if rot_pattern and isinstance(rot_pattern, dict):
                            rot_state = get_rotation_day_state(rot_pattern, now_local)
                            cur_shift_name = rot_state.get("shift_name", "نوبت‌کاری چرخشی")
                            cur_shift_window_str = rot_state.get("time_range", shift_window_str)
                            cur_in_schedule = rot_state.get("is_active_now", False)
                            cur_is_overnight = rot_state.get("is_overnight", False)
                            cur_elapsed_shift_mins = rot_state.get("elapsed_minutes", 0)
                            if rot_state.get("shift_start"):
                                cur_shift_start_dt = rot_state["shift_start"]
                                cur_start_str = cur_shift_start_dt.strftime("%H:%M")
                            if rot_state.get("shift_end"):
                                cur_shift_end_dt = rot_state["shift_end"]
                                cur_end_str = cur_shift_end_dt.strftime("%H:%M")
                            if cur_shift_start_dt and cur_shift_end_dt:
                                cur_dur_h = max(0.1, round((cur_shift_end_dt - cur_shift_start_dt).total_seconds() / 3600.0, 1))
                        else:
                            p_start = str(cs.get("start_time") or "08:00").strip()
                            p_end = str(cs.get("end_time") or "17:00").strip()
                            p_days = _parse_list_field(cs.get("active_days"), ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"])
                            cur_days = p_days
                            cur_in_schedule, cur_shift_start_dt, cur_shift_end_dt, cur_is_overnight, cur_dur_h, cur_elapsed_shift_mins = get_shift_window(
                                p_start, p_end, p_days, now_local
                            )
                            cur_start_str = p_start
                            cur_end_str = p_end
                            cur_shift_window_str = f"{p_start} - {p_end}"
                            cur_shift_name = cs.get("name") or "شیفت سفارشی"

                        if cs.get("grace_period_minutes") is not None:
                            cur_grace = int(cs["grace_period_minutes"])
                        if cs.get("absence_timeout_minutes") is not None:
                            cur_timeout = int(cs["absence_timeout_minutes"])
                        person_breaks = _parse_list_field(cs.get("free_times"), [])

                    # 2. Shift template assigned by supervisor
                    elif person.shift_template_id and person.shift_template_id in shift_templates_map:
                        st = shift_templates_map[person.shift_template_id]
                        if getattr(st, "shift_type", "fixed") in ("rotational", "rotation") and st.rotation_pattern:
                            rot_pattern = st.rotation_pattern
                            if rot_pattern and isinstance(rot_pattern, dict):
                                rot_state = get_rotation_day_state(rot_pattern, now_local)
                                cur_shift_name = rot_state.get("shift_name", st.name)
                                cur_shift_window_str = rot_state.get("time_range", shift_window_str)
                                cur_in_schedule = rot_state.get("is_active_now", False)
                                cur_is_overnight = rot_state.get("is_overnight", False)
                                cur_elapsed_shift_mins = rot_state.get("elapsed_minutes", 0)
                                if rot_state.get("shift_start"):
                                    cur_shift_start_dt = rot_state["shift_start"]
                                    cur_start_str = cur_shift_start_dt.strftime("%H:%M")
                                if rot_state.get("shift_end"):
                                    cur_shift_end_dt = rot_state["shift_end"]
                                    cur_end_str = cur_shift_end_dt.strftime("%H:%M")
                                if cur_shift_start_dt and cur_shift_end_dt:
                                    cur_dur_h = max(0.1, round((cur_shift_end_dt - cur_shift_start_dt).total_seconds() / 3600.0, 1))
                        else:
                            p_start = str(st.start_time or "08:00").strip()
                            p_end = str(st.end_time or "17:00").strip()
                            p_days = _parse_list_field(st.active_days, ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"])
                            cur_days = p_days
                            cur_in_schedule, cur_shift_start_dt, cur_shift_end_dt, cur_is_overnight, cur_dur_h, cur_elapsed_shift_mins = get_shift_window(
                                p_start, p_end, p_days, now_local
                            )
                            cur_start_str = p_start
                            cur_end_str = p_end
                            cur_shift_window_str = f"{p_start} - {p_end}"
                            cur_shift_name = st.name

                        if getattr(st, "grace_period_minutes", None) is not None:
                            cur_grace = int(st.grace_period_minutes)
                        if getattr(st, "absence_timeout_minutes", None) is not None:
                            cur_timeout = int(st.absence_timeout_minutes)
                        person_breaks = _parse_list_field(st.free_times, [])
                    elif person.shift_template_id == 0 and not person.custom_shift:
                        # Explicitly set to floating/flexible shift
                        cur_shift_name = "شیفت شناور"
                        cur_shift_window_str = "شناور"

                if only_active and not cur_in_schedule:
                    continue

                # Check live presence via stream processor
                key = (z.id, pid)
                last_seen = stream_processor._zone_last_seen.get(key, 0)
                is_cam_online = stream_processor.is_camera_online(z.camera_id)
                shift_start_ts = cur_shift_start_dt.timestamp() if cur_shift_start_dt else 0
                seen_in_shift = (last_seen > 0) and (last_seen >= shift_start_ts)

                combined_free = list(s_free) + person_breaks
                cur_in_free_time, cur_break_name = is_time_in_free_time(combined_free, now_local)
                is_within_grace = False
                timeout_secs = float(cur_timeout * 60)
                s_timeout = cur_timeout
                s_grace = cur_grace
                s_days = cur_days

                today_str = now_local.strftime("%Y-%m-%d")
                is_on_leave = False
                leave_record = None
                if person and getattr(person, "leaves", None):
                    for l in person.leaves:
                        if isinstance(l, dict):
                            s_date = str(l.get("start_date", "")).strip()
                            e_date = str(l.get("end_date", "")).strip() or s_date
                            if s_date <= today_str <= e_date:
                                is_on_leave = True
                                leave_record = l
                                break

                if is_on_leave:
                    status_str = "on_leave"
                    is_in_zone = False
                    last_seen_sec = None
                    l_type_fa = "مرخصی" if leave_record.get("leave_type") == "daily_leave" else ("استعلاجی" if leave_record.get("leave_type") == "sick" else "آف شیفت")
                    last_seen_str = f"مرخصی / آف ({l_type_fa})"
                    curr_absence_mins = 0
                elif rot_state and rot_state.get("shift_kind") == "off":
                    status_str = "off_duty"
                    is_in_zone = False
                    last_seen_sec = None
                    last_seen_str = f"آف چرخشی ({cur_shift_name})"
                    curr_absence_mins = 0
                elif not cur_in_schedule:
                    status_str = "off_duty"
                    is_in_zone = False
                    last_seen_sec = None
                    last_seen_str = "Off Duty (Outside Shift)"
                    curr_absence_mins = 0
                elif not is_cam_online:
                    status_str = "camera_offline"
                    is_in_zone = False
                    last_seen_sec = None
                    last_seen_str = "Camera Disconnected"
                    curr_absence_mins = 0
                elif cur_in_free_time:
                    # During Free Times & Breaks: Never absent, 0 absence minutes
                    if seen_in_shift and (now_ts - last_seen) < timeout_secs:
                        status_str = "present"
                        is_in_zone = True
                        last_seen_sec = round(now_ts - last_seen, 1)
                        last_seen_str = f"In Zone (seen {int(last_seen_sec)}s ago)" if last_seen_sec < 60 else f"In Zone (seen {int(last_seen_sec // 60)}m ago)"
                        curr_absence_mins = 0
                    else:
                        status_str = "on_break"
                        is_in_zone = False
                        last_seen_sec = round(now_ts - last_seen, 1) if seen_in_shift else None
                        last_seen_str = f"On Break ({cur_break_name})"
                        curr_absence_mins = 0
                elif seen_in_shift and (now_ts - last_seen) < timeout_secs:
                    # Missing for less than Absence Alarm Grace Timer: Present, 0 absence minutes!
                    status_str = "present"
                    is_in_zone = True
                    last_seen_sec = round(now_ts - last_seen, 1)
                    last_seen_str = f"In Zone (seen {int(last_seen_sec)}s ago)" if last_seen_sec < 60 else f"In Zone (seen {int(last_seen_sec // 60)}m ago)"
                    curr_absence_mins = 0
                elif not seen_in_shift and cur_elapsed_shift_mins <= s_grace:
                    # Within Arrival Grace Period: Present / in grace, 0 absence minutes!
                    is_within_grace = True
                    status_str = "present"
                    is_in_zone = False
                    last_seen_sec = None
                    last_seen_str = f"Arrival Grace Period ({cur_elapsed_shift_mins}/{s_grace}m)"
                    curr_absence_mins = 0
                else:
                    # Exceeded threshold or arrival grace
                    if seen_in_shift:
                        last_seen_sec = round(now_ts - last_seen, 1)
                        raw_missing_mins = max(1, int(last_seen_sec // 60))
                        last_dt = datetime.fromtimestamp(last_seen)
                        free_since = get_interval_free_minutes(last_dt, now_local, combined_free)
                        net_missing = max(0, raw_missing_mins - free_since)
                        if net_missing < s_timeout:
                            status_str = "present"
                            is_in_zone = True
                            curr_absence_mins = 0
                            last_seen_str = f"In Zone (seen {raw_missing_mins}m ago)"
                        else:
                            status_str = "absent"
                            is_in_zone = False
                            curr_absence_mins = net_missing
                            last_seen_str = f"Missing for {curr_absence_mins}m"
                    else:
                        status_str = "absent"
                        is_in_zone = False
                        last_seen_sec = None
                        last_seen_str = "Not Seen Yet"
                        free_since_start = get_interval_free_minutes(cur_shift_start_dt, now_local, combined_free) if cur_shift_start_dt else 0
                        curr_absence_mins = max(1, cur_elapsed_shift_mins - free_since_start) if cur_elapsed_shift_mins > 0 else 0

                # Filter ONLY actual face detection sightings for this shift (from cur_shift_start_dt to min(now_local, cur_shift_end_dt))
                shift_events = []
                for ev in recent_events:
                    if ev.person_id == pid and ev.alert_type not in ("absence_timeout", "camera_disconnected"):
                        ev_loc = _to_local_dt(ev.timestamp)
                        if cur_shift_start_dt and cur_shift_end_dt and (cur_shift_start_dt <= ev_loc <= min(now_local, cur_shift_end_dt)):
                            shift_events.append(ev)

                absence_intervals: list[AbsenceInterval] = []
                raw_arrival_delay = 0

                if cur_in_schedule and cur_elapsed_shift_mins > 0:
                    if not shift_events:
                        # No actual face sightings during shift
                        if not is_cam_online or cur_in_free_time:
                            shift_absence_mins = 0
                            shift_presence_mins = 0
                            compliance = 100.0
                        elif cur_elapsed_shift_mins <= s_grace:
                            # Within arrival grace period — suppress absence
                            is_within_grace = True
                            shift_absence_mins = 0
                            shift_presence_mins = cur_elapsed_shift_mins
                            compliance = 100.0
                        else:
                            free_since_start = get_interval_free_minutes(cur_shift_start_dt, now_local, combined_free) if cur_shift_start_dt else 0
                            net_unseen = max(0, cur_elapsed_shift_mins - free_since_start)
                            shift_absence_mins = net_unseen
                            shift_presence_mins = 0
                            compliance = 0.0
                            if net_unseen >= s_timeout:
                                curr_t_str = now_local.strftime("%H:%M")
                                absence_intervals.append(
                                    AbsenceInterval(
                                        start_time=cur_start_str,
                                        end_time=curr_t_str,
                                        duration_minutes=net_unseen,
                                        duration_str=_format_duration(net_unseen * 60),
                                        interval_type="unseen",
                                    )
                                )
                    else:
                        first_ev_loc = _to_local_dt(shift_events[0].timestamp)
                        raw_delay = max(0, int((first_ev_loc - cur_shift_start_dt).total_seconds() // 60)) if (is_cam_online and cur_shift_start_dt) else 0
                        raw_arrival_delay = raw_delay

                        if 0 <= raw_delay <= s_grace:
                            is_within_grace = True
                            effective_delay = 0
                        else:
                            free_arr = get_interval_free_minutes(cur_shift_start_dt, first_ev_loc, combined_free) if cur_shift_start_dt else 0
                            net_delay = max(0, raw_delay - free_arr)
                            if is_cam_online and net_delay > s_grace and net_delay >= s_timeout:
                                first_t_str = first_ev_loc.strftime("%H:%M")
                                absence_intervals.append(
                                    AbsenceInterval(
                                        start_time=cur_start_str,
                                        end_time=first_t_str,
                                        duration_minutes=net_delay,
                                        duration_str=_format_duration(net_delay * 60),
                                        interval_type="late_arrival",
                                    )
                                )
                                effective_delay = net_delay
                            else:
                                effective_delay = 0

                        # Disconnect events for this camera
                        cam_disc_events = [
                            ev for ev in recent_events
                            if ev.camera_id == z.camera_id and ev.alert_type == "camera_disconnected"
                        ]

                        # Gaps between detections inside shift (excluding camera downtime and free times)
                        gaps_mins = 0
                        for idx in range(len(shift_events) - 1):
                            t1 = shift_events[idx].timestamp
                            t2 = shift_events[idx + 1].timestamp
                            t1_loc = _to_local_dt(t1)
                            t2_loc = _to_local_dt(t2)
                            gap_raw = max(0, int((t2_loc - t1_loc).total_seconds() // 60))
                            if gap_raw >= s_timeout:
                                was_offline = any(t1 <= dev.timestamp <= t2 for dev in cam_disc_events)
                                if not was_offline:
                                    free_gap = get_interval_free_minutes(t1_loc, t2_loc, combined_free)
                                    net_gap = max(0, gap_raw - free_gap)
                                    if net_gap >= s_timeout:
                                        gaps_mins += net_gap
                                        absence_intervals.append(
                                            AbsenceInterval(
                                                start_time=t1_loc.strftime("%H:%M"),
                                                end_time=t2_loc.strftime("%H:%M"),
                                                duration_minutes=net_gap,
                                                duration_str=_format_duration(net_gap * 60),
                                                interval_type="gap",
                                            )
                                        )

                        # Trailing absence from last sighting to now
                        if is_in_zone or not is_cam_online or cur_in_free_time:
                            trailing_absence = 0
                        else:
                            last_ev_loc = _to_local_dt(shift_events[-1].timestamp)
                            raw_trailing = max(0, int((now_local - last_ev_loc).total_seconds() // 60))
                            free_trailing = get_interval_free_minutes(last_ev_loc, now_local, combined_free)
                            net_trailing = max(0, raw_trailing - free_trailing)
                            if net_trailing >= s_timeout:
                                trailing_absence = net_trailing
                                absence_intervals.append(
                                    AbsenceInterval(
                                        start_time=last_ev_loc.strftime("%H:%M"),
                                        end_time=now_local.strftime("%H:%M"),
                                        duration_minutes=trailing_absence,
                                        duration_str=_format_duration(trailing_absence * 60),
                                        interval_type="current",
                                    )
                                )
                            else:
                                trailing_absence = 0

                        if not is_cam_online:
                            shift_absence_mins = min(cur_elapsed_shift_mins, gaps_mins)
                        else:
                            shift_absence_mins = min(cur_elapsed_shift_mins, effective_delay + gaps_mins + trailing_absence)

                        shift_presence_mins = max(0, cur_elapsed_shift_mins - shift_absence_mins)
                        compliance = round((shift_presence_mins / cur_elapsed_shift_mins) * 100, 1) if cur_elapsed_shift_mins > 0 else 100.0
                else:
                    shift_absence_mins = 0
                    shift_presence_mins = 0
                    compliance = 100.0

                roster.append(
                    PersonDutyStatus(
                        person_id=pid,
                        person_name=person_name,
                        person_role=person_role,
                        avatar_url=avatar_url,
                        zone_id=z.id,
                        zone_name=z.name,
                        camera_id=z.camera_id,
                        camera_name=camera_name,
                        shift_start_time=cur_start_str,
                        shift_end_time=cur_end_str,
                        shift_window_str=cur_shift_window_str,
                        shift_duration_hours=cur_dur_h,
                        active_days=s_days,
                        absence_timeout_minutes=s_timeout,
                        grace_period_minutes=s_grace,
                        free_times=s_free,
                        shift_name=cur_shift_name if cur_shift_name else None,
                        is_overnight=cur_is_overnight,
                        is_in_duty_hours=cur_in_schedule,
                        is_in_free_time=in_free_time,
                        current_break_name=break_name if in_free_time else None,
                        status=status_str,
                        camera_online=is_cam_online,
                        is_in_zone=is_in_zone,
                        last_seen_seconds_ago=last_seen_sec,
                        last_seen_str=last_seen_str,
                        current_absence_minutes=curr_absence_mins,
                        current_absence_str=_format_duration(curr_absence_mins * 60),
                        shift_elapsed_minutes=cur_elapsed_shift_mins,
                        shift_presence_minutes=shift_presence_mins,
                        shift_presence_str=_format_duration(shift_presence_mins * 60),
                        shift_absence_minutes=shift_absence_mins,
                        shift_absence_str=_format_duration(shift_absence_mins * 60),
                        shift_compliance_pct=compliance,
                        absence_count=len(absence_intervals),
                        absence_intervals=absence_intervals,
                        arrival_delay_minutes=raw_arrival_delay,
                        is_within_grace_period=is_within_grace,
                    )
                )

    # Sort: absent first, then camera_offline, then present, then on_break, then off_duty
    roster.sort(key=lambda r: (
        0 if r.status == "absent" else (1 if r.status == "camera_offline" else (2 if r.status == "present" else (3 if r.status == "on_break" else 4))),
        -r.current_absence_minutes,
        r.person_name,
    ))

    total_on_duty = len([r for r in roster if r.is_in_duty_hours])
    present_count = len([r for r in roster if r.status == "present"])
    absent_count = len([r for r in roster if r.status == "absent"])
    camera_offline_count = len([r for r in roster if r.status == "camera_offline"])
    on_break_count = len([r for r in roster if r.status == "on_break"])
    on_leave_count = len([r for r in roster if r.status == "on_leave"])
    total_absence_incidents = sum(r.absence_count for r in roster)
    total_shift_absence_minutes = sum(r.shift_absence_minutes for r in roster)
    avg_compliance = round(sum(r.shift_compliance_pct for r in roster) / len(roster), 1) if roster else 100.0

    return DutyRosterResponse(
        server_time=now_local.strftime("%H:%M:%S"),
        total_on_duty=total_on_duty,
        present_count=present_count,
        absent_count=absent_count,
        camera_offline_count=camera_offline_count,
        on_break_count=on_break_count,
        on_leave_count=on_leave_count,
        total_absence_incidents=total_absence_incidents,
        total_shift_absence_minutes=total_shift_absence_minutes,
        total_shift_absence_str=_format_duration(total_shift_absence_minutes * 60),
        avg_compliance_pct=avg_compliance,
        roster=roster,
    )


@router.get("/api/zones/duty-roster", response_model=DutyRosterResponse)
async def get_duty_roster(
    only_active: bool = Query(True, description="Filter only persons currently in their active duty hours"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("duty:view")),
):
    """
    Real-time duty roster monitoring:
    - Lists personnel currently in scheduled duty hours (or all assigned if only_active=False)
    - Shift time window and active days
    - Scoped for supervisors to only show assigned persons and camera zones
    """
    duty_data = await compute_duty_roster_data(db=db, only_active=only_active)
    scope = await get_user_scope(_user, db)
    if scope.is_scoped:
        duty_data.roster = [
            r for r in duty_data.roster
            if (scope.person_ids and r.person_id in scope.person_ids) or
               (scope.camera_ids and r.camera_id in scope.camera_ids)
        ]
        duty_data.total_on_duty = len([r for r in duty_data.roster if r.is_in_duty_hours])
        duty_data.present_count = len([r for r in duty_data.roster if r.status == "present"])
        duty_data.absent_count = len([r for r in duty_data.roster if r.status == "absent"])
        duty_data.camera_offline_count = len([r for r in duty_data.roster if r.status == "camera_offline"])
        duty_data.on_break_count = len([r for r in duty_data.roster if r.status == "on_break"])
        duty_data.on_leave_count = len([r for r in duty_data.roster if r.status == "on_leave"])
        duty_data.total_absence_incidents = sum(r.absence_count for r in duty_data.roster)
        duty_data.total_shift_absence_minutes = sum(r.shift_absence_minutes for r in duty_data.roster)
        duty_data.avg_compliance_pct = round(
            sum(r.shift_compliance_pct for r in duty_data.roster) / len(duty_data.roster), 1
        ) if duty_data.roster else 100.0

    # Redact avatar photo URLs for supervisor role
    if getattr(_user, "role", None) and _user.role.name == "supervisor":
        for r in duty_data.roster:
            r.avatar_url = None

    return duty_data


@router.get("/api/zones/duty-roster/export")
async def export_duty_roster(
    format: str = Query("xlsx", pattern="^(xlsx|csv)$", description="Export format: xlsx or csv"),
    only_active: bool = Query(True, description="Filter only persons currently in their active duty hours"),
    status: Optional[str] = Query(None, description="Optional status filter: present, absent, camera_offline, on_break, all"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("duty:view")),
):
    """
    Export live duty roster attendance records and compliance stats as Excel (.xlsx) or CSV.
    """
    duty_data = await compute_duty_roster_data(db=db, only_active=only_active)
    scope = await get_user_scope(_user, db)
    if scope.is_scoped:
        duty_data.roster = [
            r for r in duty_data.roster
            if (scope.person_ids and r.person_id in scope.person_ids) or
               (scope.camera_ids and r.camera_id in scope.camera_ids)
        ]
    roster = duty_data.roster
    if status and status != "all":
        roster = [r for r in roster if r.status == status]

    now = datetime.now()
    timestamp_slug = now.strftime("%Y%m%d_%H%M%S")

    if format.lower() == "csv":
        file_bytes = generate_duty_roster_csv(roster, report_date=now)
        filename = f"duty_roster_{timestamp_slug}.csv"
        media_type = "text/csv; charset=utf-8"
    else:
        file_bytes = generate_duty_roster_xlsx(roster, report_date=now)
        filename = f"duty_roster_{timestamp_slug}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/api/zones/logs", response_model=EventListResponse)
async def get_zone_logs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("dashboard:view")),
):
    """Get paginated zone violations, absence timeout alerts, and unauthorized entry logs."""
    conditions = [
        or_(
            Event.alert_type.in_(["out_of_zone", "unauthorized_entry", "absence_timeout", "camera_disconnected"]),
            Event.zone_id.isnot(None),
        )
    ]
    scope = await get_user_scope(_user, db)
    if scope.is_scoped:
        scope_clauses = []
        if scope.camera_ids:
            scope_clauses.append(Event.camera_id.in_(scope.camera_ids))
        if scope.person_ids:
            scope_clauses.append(Event.person_id.in_(scope.person_ids))
        if scope_clauses:
            conditions.append(or_(*scope_clauses))
        else:
            conditions.append(Event.id == -1)

    where_clause = and_(*conditions)
    count_query = select(func.count(Event.id)).where(where_clause)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = (
        select(Event)
        .where(where_clause)
        .order_by(desc(Event.timestamp))
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    events = result.scalars().all()

    cameras_result = await db.execute(select(Camera))
    camera_map = {c.id: c.name for c in cameras_result.scalars().all()}

    event_responses = []
    for e in events:
        ts = e.timestamp
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        cam_name = camera_map.get(e.camera_id, f"Camera #{e.camera_id}") if e.camera_id else ""
        dur_secs = getattr(e, "duration_seconds", None)
        event_responses.append(
            EventResponse(
                id=e.id,
                timestamp=ts,
                camera_id=e.camera_id,
                camera_name=cam_name,
                person_id=e.person_id,
                person_name=e.person_name or "Unknown",
                confidence_score=e.confidence_score or 0.0,
                snapshot_path=e.snapshot_path or "",
                snapshot_url=f"/api/snapshots/{e.snapshot_path}" if e.snapshot_path else "",
                is_known=bool(e.is_known),
                zone_id=e.zone_id,
                zone_name=e.zone_name or "",
                alert_type=e.alert_type or "normal",
                duration_seconds=dur_secs,
            )
        )

    return EventListResponse(
        events=event_responses,
        total=total,
        limit=limit,
        offset=offset,
    )


# ── Direct Zone Endpoints ────────────────────────────────

@router.get("/api/zones", response_model=list[CameraZoneResponse])
async def list_all_zones(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("zones:view")),
):
    """List all defined camera zones across the system (scoped for supervisors)."""
    scope = await get_user_scope(_user, db)
    query = select(CameraZone).order_by(CameraZone.created_at.desc())
    if scope.is_scoped and scope.camera_ids is not None:
        query = query.where(CameraZone.camera_id.in_(scope.camera_ids))
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/api/zones/{zone_id}", response_model=CameraZoneResponse)
async def get_zone(
    zone_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("zones:view")),
):
    """Get details for a specific camera zone."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    scope = await get_user_scope(_user, db)
    if scope.is_scoped and not scope.can_access_camera(zone.camera_id):
        raise HTTPException(status_code=403, detail="دسترسی به این منطقه برای شما مجاز نیست.")
    return zone


@router.put("/api/zones/{zone_id}", response_model=CameraZoneResponse)
async def update_zone(
    zone_id: int,
    data: CameraZoneUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("zones:edit")),
):
    """Update a camera zone's coordinates, name, assigned persons, timetable, or alert mode."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    scope = await get_user_scope(_user, db)
    if scope.is_scoped and not scope.can_access_camera(zone.camera_id):
        raise HTTPException(status_code=403, detail="دسترسی به ویرایش این منطقه برای شما مجاز نیست.")

    if data.name is not None:
        zone.name = data.name
    if data.x is not None:
        zone.x = data.x
    if data.y is not None:
        zone.y = data.y
    if data.width is not None:
        zone.width = data.width
    if data.height is not None:
        zone.height = data.height
    if data.alert_mode is not None:
        zone.alert_mode = data.alert_mode
    if data.assigned_person_ids is not None:
        zone.assigned_person_ids = data.assigned_person_ids
    if data.start_time is not None:
        zone.start_time = data.start_time
    if data.end_time is not None:
        zone.end_time = data.end_time
    if data.active_days is not None:
        zone.active_days = data.active_days
    if data.absence_timeout_minutes is not None:
        zone.absence_timeout_minutes = data.absence_timeout_minutes
    if data.grace_period_minutes is not None:
        zone.grace_period_minutes = data.grace_period_minutes
    if data.free_times is not None:
        zone.free_times = data.free_times
    if data.shift_name is not None:
        zone.shift_name = data.shift_name
    if data.shifts is not None:
        zone.shifts = data.shifts
    if data.is_active is not None:
        zone.is_active = data.is_active

    await db.commit()
    await db.refresh(zone)

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    return zone


@router.delete("/api/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zone(
    zone_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("zones:delete")),
):
    """Delete a camera zone."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    scope = await get_user_scope(_user, db)
    if scope.is_scoped and not scope.can_access_camera(zone.camera_id):
        raise HTTPException(status_code=403, detail="دسترسی به حذف این منطقه برای شما مجاز نیست.")

    await db.delete(zone)
    await db.commit()

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    logger.info("Camera zone deleted: id=%d", zone_id)


# ── Shift Templates Endpoints ─────────────────────────────

@router.get("/api/shift-templates", response_model=list[ShiftTemplateResponse])
async def list_shift_templates(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("zones:view")),
):
    """List all available shift timetable templates."""
    result = await db.execute(select(ShiftTemplate).order_by(ShiftTemplate.id.asc()))
    return result.scalars().all()


@router.post("/api/shift-templates", response_model=ShiftTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_shift_template(
    data: ShiftTemplateCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("zones:create")),
):
    """Create a new reusable shift template."""
    tmpl = ShiftTemplate(
        name=data.name,
        start_time=data.start_time,
        end_time=data.end_time,
        color=data.color or "#38bdf8",
        shift_type=data.shift_type or "fixed",
        rotation_pattern=data.rotation_pattern,
        active_days=data.active_days or ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        grace_period_minutes=data.grace_period_minutes,
        absence_timeout_minutes=data.absence_timeout_minutes,
        free_times=data.free_times or [],
    )
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    await stream_processor.refresh_zones()
    return tmpl


@router.get("/api/shift-templates/{template_id}", response_model=ShiftTemplateResponse)
async def get_shift_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("zones:view")),
):
    """Get a specific shift template by ID."""
    tmpl = await db.get(ShiftTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Shift template not found")
    return tmpl


@router.put("/api/shift-templates/{template_id}", response_model=ShiftTemplateResponse)
async def update_shift_template(
    template_id: int,
    data: ShiftTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("zones:edit")),
):
    """Update an existing shift template."""
    tmpl = await db.get(ShiftTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Shift template not found")

    if data.name is not None:
        tmpl.name = data.name
    if data.start_time is not None:
        tmpl.start_time = data.start_time
    if data.end_time is not None:
        tmpl.end_time = data.end_time
    if data.color is not None:
        tmpl.color = data.color
    if data.shift_type is not None:
        tmpl.shift_type = data.shift_type
    if data.rotation_pattern is not None:
        tmpl.rotation_pattern = data.rotation_pattern
    if data.active_days is not None:
        tmpl.active_days = data.active_days
    if data.grace_period_minutes is not None:
        tmpl.grace_period_minutes = data.grace_period_minutes
    if data.absence_timeout_minutes is not None:
        tmpl.absence_timeout_minutes = data.absence_timeout_minutes
    if data.free_times is not None:
        tmpl.free_times = data.free_times

    await db.commit()
    await db.refresh(tmpl)
    await stream_processor.refresh_zones()
    return tmpl


@router.delete("/api/shift-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("zones:delete")),
):
    """Delete a shift template."""
    tmpl = await db.get(ShiftTemplate, template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Shift template not found")

    await db.delete(tmpl)
    await db.commit()
    await stream_processor.refresh_zones()
