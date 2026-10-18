"""
Event log API router.

Endpoints:
  GET /api/events       — List events with optional filters
  GET /api/events/stats — Summary statistics for the dashboard
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import require_permission
from backend.database import get_db
from backend.models import Event, Camera
from backend.reporting import generate_events_xlsx, generate_events_csv
from backend.schemas import EventResponse, EventListResponse, EventStats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse ISO 8601 string safely into a timezone-aware UTC datetime."""
    if not value:
        return None
    v = str(value).strip()
    if not v:
        return None

    # Handle Starlette URL decoding '+' as space in query parameters
    if " " in v and "+" not in v:
        parts = v.split(" ")
        if len(parts) == 2 and (":" in parts[1] or len(parts[1]) == 5):
            v = parts[0] + "+" + parts[1]
    if v.endswith("Z") or v.endswith("z"):
        v = v[:-1] + "+00:00"

    try:
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt
    except Exception as err:
        logger.warning("Failed to parse datetime query parameter '%s': %s", value, err)
        return None


def _build_event_filter_conditions(
    camera_id: Optional[int] = None,
    person_id: Optional[int] = None,
    person_name: Optional[str] = None,
    search: Optional[str] = None,
    is_known: Optional[bool] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    has_snapshot: Optional[bool] = None,
) -> list:
    """Build reusable SQLAlchemy filter conditions for event queries."""
    conditions = []

    if camera_id is not None:
        conditions.append(Event.camera_id == camera_id)
    if person_id is not None:
        conditions.append(Event.person_id == person_id)
    if is_known is not None:
        conditions.append(Event.is_known == is_known)
    if has_snapshot is True:
        conditions.append(and_(Event.snapshot_path.isnot(None), Event.snapshot_path != ""))
    elif has_snapshot is False:
        conditions.append(or_(Event.snapshot_path.is_(None), Event.snapshot_path == ""))
    if person_name is not None and person_name.strip():
        conditions.append(Event.person_name.ilike(f"%{person_name.strip()}%"))
    if search is not None and search.strip():
        search_term = f"%{search.strip()}%"
        cam_subquery = select(Camera.id).where(
            or_(
                Camera.name.ilike(search_term),
                Camera.location.ilike(search_term),
            )
        )
        conditions.append(
            or_(
                Event.person_name.ilike(search_term),
                Event.camera_id.in_(cam_subquery),
            )
        )

    parsed_start = _parse_iso_datetime(start_time)
    if parsed_start is not None:
        conditions.append(Event.timestamp >= parsed_start)

    parsed_end = _parse_iso_datetime(end_time)
    if parsed_end is not None:
        conditions.append(Event.timestamp <= parsed_end)

    return conditions


@router.get("", response_model=EventListResponse)
async def list_events(
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    person_id: Optional[int] = Query(None, description="Filter by person ID"),
    person_name: Optional[str] = Query(None, description="Filter by person name (partial match)"),
    search: Optional[str] = Query(None, description="Search by person name or camera name (partial match)"),
    is_known: Optional[bool] = Query(None, description="Filter known (true) or unknown (false)"),
    has_snapshot: Optional[bool] = Query(None, description="Filter events with snapshot image"),
    start_time: Optional[str] = Query(None, description="Start of time range (ISO 8601)"),
    end_time: Optional[str] = Query(None, description="End of time range (ISO 8601)"),
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("dashboard:view")),
):
    """
    List detection events with optional filtering.

    Supports filtering by camera, person ID, person name, search term, known/unknown status, and time range.
    Results are ordered newest-first with pagination.
    """
    # Build query with filters
    conditions = _build_event_filter_conditions(
        camera_id=camera_id,
        person_id=person_id,
        person_name=person_name,
        search=search,
        is_known=is_known,
        start_time=start_time,
        end_time=end_time,
        has_snapshot=has_snapshot,
    )

    where_clause = and_(*conditions) if conditions else True

    # Count total matching events
    count_query = select(func.count(Event.id)).where(where_clause)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Fetch paginated events
    query = (
        select(Event)
        .where(where_clause)
        .order_by(Event.timestamp.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    events = result.scalars().all()

    # Build response with camera names and snapshot URLs
    event_responses = []
    # Cache camera names to avoid repeated lookups
    camera_cache: dict[int, str] = {}

    for event in events:
        camera_name = ""
        if event.camera_id:
            if event.camera_id not in camera_cache:
                cam = await db.get(Camera, event.camera_id)
                camera_cache[event.camera_id] = cam.name if cam else ""
            camera_name = camera_cache[event.camera_id]

        ts = event.timestamp
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        event_responses.append(
            EventResponse(
                id=event.id,
                timestamp=ts,
                camera_id=event.camera_id,
                camera_name=camera_name,
                person_id=event.person_id,
                person_name=event.person_name or "Unknown",
                confidence_score=event.confidence_score or 0.0,
                snapshot_path=event.snapshot_path or "",
                snapshot_url=f"/api/snapshots/{event.snapshot_path}" if event.snapshot_path else "",
                is_known=bool(event.is_known),
                zone_id=getattr(event, "zone_id", None),
                zone_name=getattr(event, "zone_name", "") or "",
                alert_type=getattr(event, "alert_type", "normal") or "normal",
                duration_seconds=getattr(event, "duration_seconds", None),
            )
        )

    return EventListResponse(
        events=event_responses,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/stats", response_model=EventStats)
async def get_event_stats(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("dashboard:view")),
):
    """
    Get summary statistics for the dashboard.

    Returns counts of total events today, known/unknown breakdowns,
    and active camera count.
    """
    # Calculate start of today (UTC)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Total events today
    total_query = select(func.count(Event.id)).where(Event.timestamp >= today_start)
    total_result = await db.execute(total_query)
    total_today = total_result.scalar() or 0

    # Known events today
    known_query = select(func.count(Event.id)).where(
        and_(Event.timestamp >= today_start, Event.is_known == True)  # noqa: E712
    )
    known_result = await db.execute(known_query)
    known_today = known_result.scalar() or 0

    # Unknown events today
    unknown_today = total_today - known_today

    # Configured cameras in database
    cameras_query = select(func.count(Camera.id)).where(Camera.is_active == True)  # noqa: E712
    cameras_result = await db.execute(cameras_query)
    total_configured = cameras_result.scalar() or 0

    # Real-time online cameras actively receiving video frames
    from backend.stream_processor import stream_processor
    online_cameras = stream_processor.get_online_cameras_count()

    return EventStats(
        total_today=total_today,
        known_today=known_today,
        unknown_today=unknown_today,
        active_cameras=online_cameras,
        total_cameras=total_configured,
    )


@router.get("/grouped")
async def get_grouped_events(
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    person_id: Optional[int] = Query(None, description="Filter by person ID"),
    person_name: Optional[str] = Query(None, description="Filter by person name (partial match)"),
    search: Optional[str] = Query(None, description="Search by person name or camera name (partial match)"),
    is_known: Optional[bool] = Query(None, description="Filter known/unknown events"),
    start_time: Optional[str] = Query(None, description="Start of time range (ISO 8601)"),
    end_time: Optional[str] = Query(None, description="End of time range (ISO 8601)"),
    limit_per_group: int = Query(15, ge=1, le=50, description="Max snapshots per person group"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("dashboard:view")),
):
    """
    Get detection events grouped by person identity.

    Supports filtering by camera, person ID, person name, search term, known/unknown status, and time range.
    Returns a list of person groups containing detection count, latest timestamp,
    and a timeline gallery of snapshots & camera locations.
    """
    conditions = _build_event_filter_conditions(
        camera_id=camera_id,
        person_id=person_id,
        person_name=person_name,
        search=search,
        is_known=is_known,
        start_time=start_time,
        end_time=end_time,
    )

    where_clause = and_(*conditions) if conditions else True

    query = (
        select(Event)
        .where(where_clause)
        .order_by(Event.timestamp.desc())
        .limit(300)
    )
    result = await db.execute(query)
    events = result.scalars().all()

    camera_cache: dict[int, str] = {}
    grouped_map: dict[str, dict] = {}

    for event in events:
        camera_name = "Camera"
        if event.camera_id:
            if event.camera_id not in camera_cache:
                cam = await db.get(Camera, event.camera_id)
                camera_cache[event.camera_id] = cam.name if cam else f"Camera #{event.camera_id}"
            camera_name = camera_cache[event.camera_id]

        ts = event.timestamp
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        # Unique key for grouping
        if event.is_known and event.person_id:
            group_key = f"person_{event.person_id}"
        else:
            group_key = f"unknown_{event.person_name}_{event.snapshot_path}"

        if group_key not in grouped_map:
            grouped_map[group_key] = {
                "group_key": group_key,
                "person_id": event.person_id,
                "person_name": event.person_name or "Unknown Person",
                "is_known": event.is_known,
                "total_detections": 0,
                "latest_timestamp": ts,
                "events": [],
            }

        group = grouped_map[group_key]
        group["total_detections"] += 1

        if len(group["events"]) < limit_per_group:
            group["events"].append({
                "id": event.id,
                "timestamp": ts,
                "camera_id": event.camera_id,
                "camera_name": camera_name,
                "confidence_score": event.confidence_score,
                "snapshot_path": event.snapshot_path,
                "snapshot_url": f"/api/snapshots/{event.snapshot_path}",
                "is_known": event.is_known,
                "person_name": event.person_name,
                "person_id": event.person_id,
            })

    grouped_list = list(grouped_map.values())
    grouped_list.sort(key=lambda g: g["latest_timestamp"], reverse=True)
    return grouped_list


@router.get("/export")
async def export_events(
    format: str = Query("xlsx", pattern="^(xlsx|csv)$", description="Export format: xlsx or csv"),
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    person_id: Optional[int] = Query(None, description="Filter by person ID"),
    person_name: Optional[str] = Query(None, description="Filter by person name (partial match)"),
    search: Optional[str] = Query(None, description="Search by person name or camera name (partial match)"),
    is_known: Optional[bool] = Query(None, description="Filter known (true) or unknown (false)"),
    has_snapshot: Optional[bool] = Query(None, description="Filter events with snapshot image"),
    start_time: Optional[str] = Query(None, description="Start of time range (ISO 8601)"),
    end_time: Optional[str] = Query(None, description="End of time range (ISO 8601)"),
    limit: int = Query(5000, ge=1, le=20000, description="Max events to export"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("dashboard:view")),
):
    """
    Export detection and security alert event logs to Excel (.xlsx) or CSV.
    """
    conditions = _build_event_filter_conditions(
        camera_id=camera_id,
        person_id=person_id,
        person_name=person_name,
        search=search,
        is_known=is_known,
        start_time=start_time,
        end_time=end_time,
        has_snapshot=has_snapshot,
    )
    where_clause = and_(*conditions) if conditions else True

    query = (
        select(Event)
        .where(where_clause)
        .order_by(Event.timestamp.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    events = result.scalars().all()

    # Pre-fetch cameras
    cams_res = await db.execute(select(Camera))
    cams = {c.id: c for c in cams_res.scalars().all()}

    # Build human-readable filter summary for report header
    filter_parts = []
    if search:
        filter_parts.append(f"جستجو: {search}")
    if camera_id and camera_id in cams:
        filter_parts.append(f"دوربین: {cams[camera_id].name}")
    if is_known is True:
        filter_parts.append("وضعیت: پرسنل مجاز")
    elif is_known is False:
        filter_parts.append("وضعیت: افراد ناشناس")
    if start_time or end_time:
        st_txt = start_time[:16].replace("T", " ") if start_time else "ابتدا"
        et_txt = end_time[:16].replace("T", " ") if end_time else "اکنون"
        filter_parts.append(f"بازه زمانی: {st_txt} تا {et_txt}")
    filter_summary = " | ".join(filter_parts) if filter_parts else None

    events_data = []
    for ev in events:
        cam = cams.get(ev.camera_id)
        events_data.append({
            "id": ev.id,
            "timestamp": ev.timestamp,
            "person_id": ev.person_id,
            "person_name": ev.person_name or "Unknown",
            "is_known": bool(ev.is_known),
            "confidence_score": ev.confidence_score or 0.0,
            "camera_id": ev.camera_id,
            "camera_name": cam.name if cam else (f"Camera #{ev.camera_id}" if ev.camera_id else "—"),
            "camera_location": cam.location if cam else "",
            "zone_id": getattr(ev, "zone_id", None),
            "zone_name": getattr(ev, "zone_name", "") or "",
            "alert_type": getattr(ev, "alert_type", "normal") or "normal",
        })

    now = datetime.now()
    timestamp_slug = now.strftime("%Y%m%d_%H%M%S")

    if format.lower() == "csv":
        file_bytes = generate_events_csv(events_data, report_date=now, filter_summary=filter_summary)
        filename = f"events_report_{timestamp_slug}.csv"
        media_type = "text/csv; charset=utf-8"
    else:
        file_bytes = generate_events_xlsx(events_data, report_date=now, filter_summary=filter_summary)
        filename = f"events_report_{timestamp_slug}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.delete("/{event_id}")
async def delete_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("events:delete")),
):
    """Delete a detection event log entry."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    await db.delete(event)
    await db.commit()
    return {"success": True, "message": "Event deleted"}
