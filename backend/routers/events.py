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

from backend.auth import require_permission, get_user_scope, UserScope
from backend.archive_manager import query_events_multi_db
from backend.database import get_db
from backend.models import Event, Camera, User
from backend.reporting import generate_events_xlsx, generate_events_csv
from backend.schemas import EventResponse, EventListResponse, EventStats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])


async def _apply_user_scope_to_conditions(user: User, db: AsyncSession, conditions: list) -> UserScope:
    """Filter SQLAlchemy conditions so scoped supervisors only see assigned cameras and persons."""
    scope = await get_user_scope(user, db)
    if scope.is_scoped:
        scope_clauses = []
        if scope.camera_ids:
            scope_clauses.append(Event.camera_id.in_(scope.camera_ids))
        if scope.person_ids:
            scope_clauses.append(Event.person_id.in_(scope.person_ids))
        if scope_clauses:
            conditions.append(or_(*scope_clauses))
        else:
            # Scoped supervisor with empty assignment should not see other sections' events
            conditions.append(Event.id == -1)
    return scope


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
    Transparently queries across active database and historical monthly archives.
    Results are ordered newest-first with pagination.
    """
    scope = await get_user_scope(_user, db)

    rows, total = await query_events_multi_db(
        db=db,
        camera_id=camera_id,
        person_id=person_id,
        person_name=person_name,
        search=search,
        is_known=is_known,
        has_snapshot=has_snapshot,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset,
        is_scoped=scope.is_scoped,
        scope_camera_ids=scope.camera_ids,
        scope_person_ids=scope.person_ids,
    )

    # Build response with camera names and snapshot URLs
    event_responses = []
    camera_cache: dict[int, str] = {}
    is_sup = bool(getattr(_user, "role", None) and _user.role.name == "supervisor")

    for r in rows:
        cid = r.get("camera_id")
        camera_name = ""
        if cid:
            if cid not in camera_cache:
                cam = await db.get(Camera, cid)
                camera_cache[cid] = cam.name if cam else ""
            camera_name = camera_cache[cid]

        raw_snap = r.get("snapshot_path") or ""
        s_path = "" if is_sup else raw_snap
        s_url = "" if is_sup else (f"/api/snapshots/{raw_snap}" if raw_snap else "")

        event_responses.append(
            EventResponse(
                id=r["id"],
                timestamp=r["timestamp"],
                camera_id=cid,
                camera_name=camera_name,
                person_id=r.get("person_id"),
                person_name=r.get("person_name") or "Unknown",
                confidence_score=r.get("confidence_score") or 0.0,
                snapshot_path=s_path,
                snapshot_url=s_url,
                is_known=bool(r.get("is_known")),
                zone_id=r.get("zone_id"),
                zone_name=r.get("zone_name") or "",
                alert_type=r.get("alert_type") or "normal",
                duration_seconds=r.get("duration_seconds"),
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
    _user: User = Depends(require_permission("dashboard:view")),
):
    """
    Get summary statistics for the dashboard, scoped to assigned cameras/personnel for supervisors.
    """
    scope = await get_user_scope(_user, db)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    scope_conditions = [Event.timestamp >= today_start]
    if scope.is_scoped:
        scope_clauses = []
        if scope.camera_ids:
            scope_clauses.append(Event.camera_id.in_(scope.camera_ids))
        if scope.person_ids:
            scope_clauses.append(Event.person_id.in_(scope.person_ids))
        if scope_clauses:
            scope_conditions.append(or_(*scope_clauses))
        else:
            scope_conditions.append(Event.id == -1)

    # Total events today
    total_query = select(func.count(Event.id)).where(and_(*scope_conditions))
    total_result = await db.execute(total_query)
    total_today = total_result.scalar() or 0

    # Known events today
    known_conditions = list(scope_conditions) + [Event.is_known == True]
    known_query = select(func.count(Event.id)).where(and_(*known_conditions))
    known_result = await db.execute(known_query)
    known_today = known_result.scalar() or 0

    # Unknown events today
    unknown_today = max(0, total_today - known_today)

    # Configured cameras count
    if scope.is_scoped and scope.camera_ids is not None:
        cameras_query = select(func.count(Camera.id)).where(Camera.is_active == True, Camera.id.in_(scope.camera_ids))
    else:
        cameras_query = select(func.count(Camera.id)).where(Camera.is_active == True)
    cameras_result = await db.execute(cameras_query)
    total_configured = cameras_result.scalar() or 0

    # Real-time online cameras
    from backend.stream_processor import stream_processor
    if scope.is_scoped and scope.camera_ids is not None:
        online_cameras = sum(1 for cid in scope.camera_ids if stream_processor.is_camera_online(cid))
    else:
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
    scope = await get_user_scope(_user, db)
    rows, _ = await query_events_multi_db(
        db=db,
        camera_id=camera_id,
        person_id=person_id,
        person_name=person_name,
        search=search,
        is_known=is_known,
        start_time=start_time,
        end_time=end_time,
        limit=300,
        offset=0,
        is_scoped=scope.is_scoped,
        scope_camera_ids=scope.camera_ids,
        scope_person_ids=scope.person_ids,
    )

    camera_cache: dict[int, str] = {}
    grouped_map: dict[str, dict] = {}

    for event in rows:
        cid = event.get("camera_id")
        camera_name = "Camera"
        if cid:
            if cid not in camera_cache:
                cam = await db.get(Camera, cid)
                camera_cache[cid] = cam.name if cam else f"Camera #{cid}"
            camera_name = camera_cache[cid]

        ts = event["timestamp"]

        # Unique key for grouping
        is_known_ev = event.get("is_known")
        pid = event.get("person_id")
        pname = event.get("person_name") or "Unknown Person"
        spath = event.get("snapshot_path") or ""

        if is_known_ev and pid:
            group_key = f"person_{pid}"
        else:
            group_key = f"unknown_{pname}_{spath}"

        if group_key not in grouped_map:
            grouped_map[group_key] = {
                "group_key": group_key,
                "person_id": pid,
                "person_name": pname,
                "is_known": is_known_ev,
                "total_detections": 0,
                "latest_timestamp": ts,
                "events": [],
            }

        group = grouped_map[group_key]
        group["total_detections"] += 1

        if len(group["events"]) < limit_per_group:
            is_sup = bool(getattr(_user, "role", None) and _user.role.name == "supervisor")
            group["events"].append({
                "id": event["id"],
                "timestamp": ts,
                "camera_id": cid,
                "camera_name": camera_name,
                "confidence_score": event.get("confidence_score") or 0.0,
                "snapshot_path": "" if is_sup else spath,
                "snapshot_url": "" if is_sup else (f"/api/snapshots/{spath}" if spath else ""),
                "is_known": is_known_ev,
                "person_name": pname,
                "person_id": pid,
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
    scope = await get_user_scope(_user, db)
    rows, _ = await query_events_multi_db(
        db=db,
        camera_id=camera_id,
        person_id=person_id,
        person_name=person_name,
        search=search,
        is_known=is_known,
        has_snapshot=has_snapshot,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=0,
        is_scoped=scope.is_scoped,
        scope_camera_ids=scope.camera_ids,
        scope_person_ids=scope.person_ids,
    )

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
    for ev in rows:
        cid = ev.get("camera_id")
        cam = cams.get(cid)
        events_data.append({
            "id": ev["id"],
            "timestamp": ev["timestamp"],
            "person_id": ev.get("person_id"),
            "person_name": ev.get("person_name") or "Unknown",
            "is_known": bool(ev.get("is_known")),
            "confidence_score": ev.get("confidence_score") or 0.0,
            "camera_id": cid,
            "camera_name": cam.name if cam else (f"Camera #{cid}" if cid else "—"),
            "camera_location": cam.location if cam else "",
            "zone_id": ev.get("zone_id"),
            "zone_name": ev.get("zone_name") or "",
            "alert_type": ev.get("alert_type") or "normal",
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
    """Delete a detection event log entry from active DB or archives."""
    event = await db.get(Event, event_id)
    if event:
        await db.delete(event)
        await db.commit()
        return {"success": True, "message": "Event deleted"}

    # Search in monthly archive databases if not in active DB
    import sqlite3
    from backend.archive_manager import get_archive_dir, MONTH_SLUG_REGEX
    archive_dir = get_archive_dir()
    if archive_dir.is_dir():
        for folder in archive_dir.iterdir():
            if folder.is_dir() and MONTH_SLUG_REGEX.match(folder.name):
                db_path = folder / f"events_{folder.name}.db"
                if db_path.is_file():
                    with sqlite3.connect(str(db_path)) as conn:
                        cur = conn.cursor()
                        cur.execute("DELETE FROM events WHERE id = ?", (event_id,))
                        if cur.rowcount > 0:
                            conn.commit()
                            return {"success": True, "message": f"Event deleted from archive {folder.name}"}

    raise HTTPException(status_code=404, detail="Event not found")
