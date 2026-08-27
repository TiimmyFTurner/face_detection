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
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, desc, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import Camera, CameraZone, Person, Event
from backend.schemas import (
    CameraZoneCreate,
    CameraZoneUpdate,
    CameraZoneResponse,
    ZoneStatusResponse,
    ZonePersonStatus,
    EventResponse,
    EventListResponse,
)
from backend.stream_processor import stream_processor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["zones"])


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


def is_time_in_timetable(start_time: Any, end_time: Any, active_days: Any) -> bool:
    """Check if the current local time and day falls within a timetable."""
    now = datetime.now()
    day_name = now.strftime("%a")  # e.g. "Mon", "Tue"

    days_list = _parse_list_field(active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])

    if days_list and day_name not in days_list:
        return False

    current_hm = now.strftime("%H:%M")
    start = str(start_time) if start_time else "00:00"
    end = str(end_time) if end_time else "23:59"

    if start <= end:
        return start <= current_hm <= end
    else:
        # Overnight shift (e.g. 22:00 to 06:00)
        return current_hm >= start or current_hm <= end


# ── Camera-Scoped Endpoints ──────────────────────────────

@router.get("/api/cameras/{camera_id}/zones", response_model=list[CameraZoneResponse])
async def list_camera_zones(camera_id: int, db: AsyncSession = Depends(get_db)):
    """List all important areas/zones defined on a specific camera."""
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
):
    """Create a new important area/zone on a camera with timetable and assigned persons."""
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
async def get_zones_status(db: AsyncSession = Depends(get_db)):
    """
    Get the real-time presence status board for all configured camera zones.
    Shows whether assigned persons are currently in their zones, absent, or off-duty.
    """
    zones_result = await db.execute(select(CameraZone).order_by(CameraZone.created_at.asc()))
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

        in_schedule = is_time_in_timetable(
            z.start_time or "00:00",
            z.end_time or "23:59",
            active_days,
        )

        days_str = ",".join(str(d) for d in active_days) if active_days else "All Days"
        timetable_text = f"{z.start_time or '00:00'} - {z.end_time or '23:59'} ({days_str})"

        assigned_status_list: list[ZonePersonStatus] = []
        raw_assigned = _parse_list_field(z.assigned_person_ids, [])
        assigned_ids = [int(x) for x in raw_assigned if str(x).isdigit()]

        for pid in assigned_ids:
            pname = person_map.get(pid, f"Person #{pid}")
            key = (z.id, pid)
            last_seen = stream_processor._zone_last_seen.get(key, 0)

            if not in_schedule:
                status_str = "off_duty"
                last_seen_sec = None
                last_seen_str = "Off Duty (Outside Timetable)"
                minutes_absent = None
            elif last_seen > 0 and (now - last_seen) < 120.0:
                status_str = "present"
                last_seen_sec = round(now - last_seen, 1)
                last_seen_str = f"In Zone (seen {int(last_seen_sec)}s ago)"
                minutes_absent = 0
            else:
                status_str = "absent"
                if last_seen > 0:
                    last_seen_sec = round(now - last_seen, 1)
                    mins = max(1, int(last_seen_sec // 60))
                    last_seen_str = f"Missing for {mins}m"
                    minutes_absent = mins
                else:
                    last_seen_sec = None
                    last_seen_str = "Not Seen Yet"
                    minutes_absent = None

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
                assigned_persons=assigned_status_list,
            )
        )

    return response_list


@router.get("/api/zones/logs", response_model=EventListResponse)
async def get_zone_logs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated zone violations, absence timeout alerts, and unauthorized entry logs."""
    where_clause = or_(
        Event.alert_type.in_(["out_of_zone", "unauthorized_entry", "absence_timeout"]),
        Event.zone_id.isnot(None),
    )

    # Total count
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
async def list_all_zones(db: AsyncSession = Depends(get_db)):
    """List all defined camera zones across the system."""
    result = await db.execute(select(CameraZone).order_by(CameraZone.created_at.desc()))
    return result.scalars().all()


@router.get("/api/zones/{zone_id}", response_model=CameraZoneResponse)
async def get_zone(zone_id: int, db: AsyncSession = Depends(get_db)):
    """Get details for a specific camera zone."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


@router.put("/api/zones/{zone_id}", response_model=CameraZoneResponse)
async def update_zone(
    zone_id: int,
    data: CameraZoneUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a camera zone's coordinates, name, assigned persons, timetable, or alert mode."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

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
    if data.is_active is not None:
        zone.is_active = data.is_active

    await db.commit()
    await db.refresh(zone)

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    return zone


@router.delete("/api/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zone(zone_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a camera zone."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    await db.delete(zone)
    await db.commit()

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    logger.info("Camera zone deleted: id=%d", zone_id)
