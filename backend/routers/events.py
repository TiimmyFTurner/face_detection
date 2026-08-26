"""
Event log API router.

Endpoints:
  GET /api/events       — List events with optional filters
  GET /api/events/stats — Summary statistics for the dashboard
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import Event, Camera
from backend.schemas import EventResponse, EventListResponse, EventStats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=EventListResponse)
async def list_events(
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    person_id: Optional[int] = Query(None, description="Filter by person ID"),
    person_name: Optional[str] = Query(None, description="Filter by person name (partial match)"),
    is_known: Optional[bool] = Query(None, description="Filter known (true) or unknown (false)"),
    start_time: Optional[datetime] = Query(None, description="Start of time range (ISO 8601)"),
    end_time: Optional[datetime] = Query(None, description="End of time range (ISO 8601)"),
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: AsyncSession = Depends(get_db),
):
    """
    List detection events with optional filtering.

    Supports filtering by camera, person ID, person name, known/unknown status, and time range.
    Results are ordered newest-first with pagination.
    """
    # Build query with filters
    conditions = []

    if camera_id is not None:
        conditions.append(Event.camera_id == camera_id)
    if person_id is not None:
        conditions.append(Event.person_id == person_id)
    if is_known is not None:
        conditions.append(Event.is_known == is_known)
    if person_name is not None:
        conditions.append(Event.person_name.ilike(f"%{person_name}%"))
    if start_time is not None:
        conditions.append(Event.timestamp >= start_time)
    if end_time is not None:
        conditions.append(Event.timestamp <= end_time)

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
                camera_cache[event.camera_id] = cam.name if cam else "Deleted Camera"
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
async def get_event_stats(db: AsyncSession = Depends(get_db)):
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

    # Active cameras
    cameras_query = select(func.count(Camera.id)).where(Camera.is_active == True)  # noqa: E712
    cameras_result = await db.execute(cameras_query)
    active_cameras = cameras_result.scalar() or 0

    return EventStats(
        total_today=total_today,
        known_today=known_today,
        unknown_today=unknown_today,
        active_cameras=active_cameras,
    )


@router.get("/grouped")
async def get_grouped_events(
    is_known: Optional[bool] = Query(None, description="Filter known/unknown events"),
    limit_per_group: int = Query(15, ge=1, le=50, description="Max snapshots per person group"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detection events grouped by person identity.

    Returns a list of person groups containing detection count, latest timestamp,
    and a timeline gallery of snapshots & camera locations.
    """
    conditions = []
    if is_known is not None:
        conditions.append(Event.is_known == is_known)

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
