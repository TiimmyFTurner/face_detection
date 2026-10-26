"""
Person (identity) management API router.

Endpoints:
  GET    /api/persons              — List all known persons
  POST   /api/persons              — Create a person with reference photos
  GET    /api/persons/{id}         — Get person details
  PUT    /api/persons/{id}         — Update person name/role
  DELETE /api/persons/{id}         — Delete person and all embeddings
  POST   /api/persons/{id}/photos  — Add more reference photos
"""

import logging
import uuid
from pathlib import Path

from datetime import datetime, timezone, timedelta
from typing import Any, Optional
import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Query, Response
from sqlalchemy import select, func, and_, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.reporting import generate_person_analytics_xlsx, generate_person_analytics_csv

from backend.auth import require_permission, require_any_permission, get_user_scope
from backend.config import settings
from backend.database import get_db
from backend.face_engine import face_engine
from backend.models import Person, PersonEmbedding, Event, Camera, CameraZone, ShiftTemplate, User
from backend.schemas import (
    PersonResponse,
    PersonPhotoItem,
    PersonUpdate,
    PersonAnalyticsResponse,
    PersonSummaryStats,
    PersonShiftInfo,
    PersonShiftCompliance,
    PersonDailyActivity,
    AbsenceInterval,
    PersonHourlyActivity,
    PersonCameraDistribution,
    PersonAlertStats,
    EventResponse,
    ShiftTemplateResponse,
    PersonShiftZoneInfo,
    PersonShiftManageRequest,
    PersonShiftManageResponse,
    LeaveCreate,
)
from backend.stream_processor import stream_processor
from backend.routers.zones import is_time_in_timetable, _parse_list_field
from backend.shift_utils import get_rotation_day_state, is_time_in_free_time, get_interval_free_minutes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/persons", tags=["persons"])


def _to_local_dt(dt: datetime) -> datetime:
    """Convert UTC or naive datetime to local timezone datetime."""
    if dt is None:
        return datetime.now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone()


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


def _build_person_response(
    person: Person,
    embeddings: list[PersonEmbedding],
    summary: PersonSummaryStats | None = None,
    is_supervisor: bool = False,
) -> dict:
    """Build a PersonResponse dict from ORM objects, redacting photos for supervisors."""
    if is_supervisor:
        photo_items = []
        if summary:
            summary.last_seen_snapshot_url = None
    else:
        photo_items = [
            {
                "id": e.id,
                "url": f"/api/snapshots/ref_{Path(e.reference_photo_path).name}",
                "created_at": e.created_at,
            }
            for e in embeddings
        ]
    return {
        "id": person.id,
        "name": person.name,
        "role": person.role or "",
        "section": getattr(person, "section", "") or "",
        "shift_template_id": getattr(person, "shift_template_id", None),
        "custom_shift": getattr(person, "custom_shift", None),
        "leaves": getattr(person, "leaves", []) or [],
        "embedding_count": len(embeddings),
        "reference_photos": [p["url"] for p in photo_items],
        "photos": photo_items,
        "created_at": person.created_at,
        "summary": summary,
    }


@router.get("", response_model=list[PersonResponse])
async def list_persons(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:view")),
):
    """
    List all known persons with their embedding counts and high-level
    detection summary statistics (scoped for supervisors).
    """
    scope = await get_user_scope(_user, db)
    query = select(Person).order_by(Person.name)
    if scope.is_scoped and scope.person_ids is not None:
        query = query.where(Person.id.in_(scope.person_ids))

    result = await db.execute(query)
    persons = result.scalars().all()

    # Query all camera zones for assigned counts
    zones_result = await db.execute(select(CameraZone))
    all_zones = zones_result.scalars().all()

    # Pre-fetch event statistics per person
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Fetch camera map
    cameras_result = await db.execute(select(Camera))
    camera_map = {c.id: c.name for c in cameras_result.scalars().all()}

    responses = []
    for person in persons:
        emb_result = await db.execute(
            select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
        )
        embeddings = emb_result.scalars().all()

        # Find zones assigned to this person
        person_zones = [
            z for z in all_zones
            if person.id in [int(x) for x in _parse_list_field(z.assigned_person_ids, []) if str(x).isdigit()]
        ]

        # Count total events
        total_ev_res = await db.execute(
            select(func.count(Event.id)).where(Event.person_id == person.id)
        )
        total_events = total_ev_res.scalar() or 0

        # Count today's events
        today_ev_res = await db.execute(
            select(func.count(Event.id)).where(
                and_(Event.person_id == person.id, Event.timestamp >= today_start)
            )
        )
        today_events = today_ev_res.scalar() or 0

        # Latest event
        latest_ev_res = await db.execute(
            select(Event)
            .where(Event.person_id == person.id)
            .order_by(Event.timestamp.desc())
            .limit(1)
        )
        latest_event = latest_ev_res.scalar()

        # Determine presence status and shift absence
        current_status = "never_seen"
        primary_shift_str = None
        current_absence_mins = None

        if person_zones:
            pz = person_zones[0]
            primary_shift_str = f"{pz.start_time or '00:00'} - {pz.end_time or '23:59'}"

        if latest_event:
            ev_ts = latest_event.timestamp
            if ev_ts and ev_ts.tzinfo is None:
                ev_ts = ev_ts.replace(tzinfo=timezone.utc)
            seconds_since = (now - ev_ts).total_seconds() if ev_ts else 999999

            if person_zones:
                pz = person_zones[0]
                is_cam_online = stream_processor.is_camera_online(pz.camera_id)
                in_shift = any(
                    is_time_in_timetable(
                        z.start_time or "00:00",
                        z.end_time or "23:59",
                        _parse_list_field(z.active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
                    )
                    for z in person_zones
                )
                if in_shift:
                    if not is_cam_online:
                        current_status = "camera_offline"
                        current_absence_mins = 0
                    elif seconds_since < 180:
                        current_status = "present"
                    else:
                        current_status = "absent"
                        current_absence_mins = max(1, int(seconds_since // 60))
                else:
                    current_status = "off_duty"
        today_absence_mins = 0
        if person_zones:
            pz = person_zones[0]
            is_cam_online = stream_processor.is_camera_online(pz.camera_id)
            today_day_name = datetime.now().strftime("%a")
            active_days = _parse_list_field(pz.active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
            if today_day_name in active_days:
                try:
                    sh, sm = map(int, (pz.start_time or "00:00").split(":"))
                    eh, em = map(int, (pz.end_time or "23:59").split(":"))
                    start_m = sh * 60 + sm
                    end_m = eh * 60 + em
                    dur_m = (end_m - start_m) if end_m >= start_m else ((24 * 60 - start_m) + end_m)
                except Exception:
                    dur_m = 480
                # Never add camera disconnected time to absence
                if current_status == "absent" and is_cam_online:
                    today_absence_mins = current_absence_mins or dur_m
                else:
                    today_absence_mins = 0

        summary = PersonSummaryStats(
            total_detections=total_events,
            today_detections=today_events,
            last_seen=latest_event.timestamp if latest_event else None,
            last_seen_camera=camera_map.get(latest_event.camera_id, f"Camera #{latest_event.camera_id}") if latest_event and latest_event.camera_id else None,
            last_seen_zone=getattr(latest_event, "zone_name", None) if latest_event else None,
            last_seen_snapshot_url=f"/api/snapshots/{latest_event.snapshot_path}" if latest_event and latest_event.snapshot_path else None,
            current_status=current_status,
            assigned_zones_count=len(person_zones),
            primary_shift_time=primary_shift_str,
            current_absence_minutes=current_absence_mins,
            today_absence_minutes=today_absence_mins,
            today_absence_hours_str=_format_duration(today_absence_mins * 60),
        )

        is_sup = bool(getattr(_user, "role", None) and _user.role.name == "supervisor")
        responses.append(_build_person_response(person, embeddings, summary, is_supervisor=is_sup))

    return responses


@router.post("", response_model=PersonResponse, status_code=status.HTTP_201_CREATED)
async def create_person(
    name: str = Form(...),
    role: str = Form(default=""),
    section: str = Form(default=""),
    photos: list[UploadFile] = File(default=[]),
    event_ids: Optional[str] = Form(default=None),
    snapshot_filenames: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:create")),
):
    """
    Create a new known person by uploading reference photos and/or selecting
    detection snapshots from unknown event logs.
    Each photo is processed to extract a 512-d face embedding.
    """
    parsed_event_ids: list[int] = []
    if event_ids:
        try:
            import json
            if event_ids.strip().startswith("["):
                parsed_event_ids = [int(x) for x in json.loads(event_ids) if str(x).isdigit()]
            else:
                parsed_event_ids = [int(x.strip()) for x in event_ids.split(",") if x.strip().isdigit()]
        except Exception as e:
            logger.warning("Failed to parse event_ids '%s': %s", event_ids, e)

    parsed_event_ids = list(dict.fromkeys(parsed_event_ids))

    parsed_snapshot_files: list[str] = []
    if snapshot_filenames:
        try:
            import json
            if snapshot_filenames.strip().startswith("["):
                parsed_snapshot_files = [str(x) for x in json.loads(snapshot_filenames) if x]
            else:
                parsed_snapshot_files = [x.strip() for x in snapshot_filenames.split(",") if x.strip()]
        except Exception as e:
            logger.warning("Failed to parse snapshot_filenames '%s': %s", snapshot_filenames, e)
    parsed_snapshot_files = list(dict.fromkeys(parsed_snapshot_files))

    valid_photos = []
    for p in (photos or []):
        if not getattr(p, "filename", None):
            continue
        if p.filename.startswith("event_"):
            try:
                ev_id_str = p.filename[len("event_") :].split(".")[0]
                if ev_id_str.isdigit() and int(ev_id_str) in parsed_event_ids:
                    continue
            except Exception:
                pass
        valid_photos.append(p)

    if not valid_photos and not parsed_event_ids and not parsed_snapshot_files:
        raise HTTPException(
            status_code=400,
            detail="At least one reference photo or detection event is required.",
        )

    # Create person record
    person = Person(
        name=name.strip(),
        role=role.strip() if role else "",
        section=section.strip() if section else "",
    )
    db.add(person)
    await db.commit()
    await db.refresh(person)

    embeddings_created: list[PersonEmbedding] = []

    # 1. Process photos from selected detection events
    for ev_id in parsed_event_ids:
        ev = await db.get(Event, ev_id)
        if not ev or not ev.snapshot_path:
            continue
        safe_name = Path(ev.snapshot_path).name
        snap_file = Path(settings.snapshot_dir) / safe_name
        if not snap_file.exists():
            continue
        image_bytes = snap_file.read_bytes()
        embedding = face_engine.extract_embedding_from_photo(image_bytes)
        if embedding is None:
            logger.warning("No face detected in snapshot for event #%d", ev_id)
            continue

        ext = snap_file.suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        with open(ref_path, "wb") as f:
            f.write(image_bytes)

        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        embeddings_created.append(person_emb)

        # Attribute the event to the newly enrolled person
        ev.person_id = person.id
        ev.person_name = person.name
        ev.is_known = True

    # 2. Process extra snapshot filenames if provided
    for s_name in parsed_snapshot_files:
        safe_name = Path(s_name).name
        snap_file = Path(settings.snapshot_dir) / safe_name
        if not snap_file.exists():
            continue
        image_bytes = snap_file.read_bytes()
        embedding = face_engine.extract_embedding_from_photo(image_bytes)
        if embedding is None:
            continue
        ext = snap_file.suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        with open(ref_path, "wb") as f:
            f.write(image_bytes)
        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        embeddings_created.append(person_emb)

    # 3. Process uploaded files
    for photo in valid_photos:
        image_bytes = await photo.read()
        if not image_bytes:
            continue
        embedding = face_engine.extract_embedding_from_photo(image_bytes)
        if embedding is None:
            logger.warning("No face detected in uploaded photo '%s'. Skipping.", photo.filename)
            continue
        ext = Path(photo.filename or "photo.jpg").suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        with open(ref_path, "wb") as f:
            f.write(image_bytes)
        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        embeddings_created.append(person_emb)

    if not embeddings_created:
        await db.delete(person)
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail="No faces could be detected in any of the selected photos or events.",
        )

    await db.commit()
    await stream_processor.refresh_known_persons()

    logger.info(
        "Person created: id=%d name='%s' embeddings=%d",
        person.id,
        name,
        len(embeddings_created),
    )

    return _build_person_response(person, embeddings_created)


@router.get("/{person_id}", response_model=PersonResponse)
async def get_person(
    person_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:view")),
):
    """Get details for a specific person."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()

    return _build_person_response(person, embeddings)


@router.put("/{person_id}", response_model=PersonResponse)
async def update_person(
    person_id: int,
    data: PersonUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:edit")),
):
    """Update a person's name, role, section, or shift."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به ویرایش این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if data.name is not None:
        person.name = data.name.strip()
    if data.role is not None:
        person.role = data.role.strip()
    if data.section is not None:
        person.section = data.section.strip()
    if data.shift_template_id is not None:
        person.shift_template_id = data.shift_template_id if data.shift_template_id > 0 else None
    if data.custom_shift is not None:
        person.custom_shift = data.custom_shift

    await db.commit()
    await db.refresh(person)

    # Refresh cache
    await stream_processor.refresh_known_persons()

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()

    is_sup = bool(getattr(_user, "role", None) and _user.role.name == "supervisor")
    return _build_person_response(person, embeddings, is_supervisor=is_sup)


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_person(
    person_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:delete")),
):
    """Delete a person and all their embeddings and reference photos."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به حذف این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Delete reference photo files
    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    for emb in emb_result.scalars().all():
        try:
            Path(emb.reference_photo_path).unlink(missing_ok=True)
        except Exception as e:
            logger.warning("Failed to delete reference photo: %s", e)

    await db.delete(person)
    await db.commit()

    # Refresh cache
    await stream_processor.refresh_known_persons()

    logger.info("Person deleted: id=%d", person_id)


@router.post("/{person_id}/photos", response_model=PersonResponse)
async def add_photos(
    person_id: int,
    photos: list[UploadFile] = File(default=[]),
    event_ids: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("persons:edit")),
):
    """Add additional reference photos for an existing person from upload or events."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    parsed_event_ids: list[int] = []
    if event_ids:
        try:
            import json
            if event_ids.strip().startswith("["):
                parsed_event_ids = [int(x) for x in json.loads(event_ids) if str(x).isdigit()]
            else:
                parsed_event_ids = [int(x.strip()) for x in event_ids.split(",") if x.strip().isdigit()]
        except Exception as e:
            logger.warning("Failed to parse event_ids '%s': %s", event_ids, e)

    parsed_event_ids = list(dict.fromkeys(parsed_event_ids))

    valid_photos = []
    for p in (photos or []):
        if not getattr(p, "filename", None):
            continue
        if p.filename.startswith("event_"):
            try:
                ev_id_str = p.filename[len("event_") :].split(".")[0]
                if ev_id_str.isdigit() and int(ev_id_str) in parsed_event_ids:
                    continue
            except Exception:
                pass
        valid_photos.append(p)

    if not valid_photos and not parsed_event_ids:
        raise HTTPException(status_code=400, detail="At least one photo or event is required.")

    added = 0

    # 1. Process from events
    for ev_id in parsed_event_ids:
        ev = await db.get(Event, ev_id)
        if not ev or not ev.snapshot_path:
            continue
        safe_name = Path(ev.snapshot_path).name
        snap_file = Path(settings.snapshot_dir) / safe_name
        if not snap_file.exists():
            continue
        image_bytes = snap_file.read_bytes()
        embedding = face_engine.extract_embedding_from_photo(image_bytes)
        if embedding is None:
            continue
        ext = snap_file.suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        with open(ref_path, "wb") as f:
            f.write(image_bytes)
        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        ev.person_id = person.id
        ev.person_name = person.name
        ev.is_known = True
        added += 1

    # 2. Process uploaded photos
    for photo in valid_photos:
        image_bytes = await photo.read()
        if not image_bytes:
            continue
        embedding = face_engine.extract_embedding_from_photo(image_bytes)
        if embedding is None:
            logger.warning("No face in photo '%s', skipping.", photo.filename)
            continue
        ext = Path(photo.filename or "photo.jpg").suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        with open(ref_path, "wb") as f:
            f.write(image_bytes)
        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        added += 1

    if added == 0:
        raise HTTPException(
            status_code=400,
            detail="No faces detected in any of the uploaded photos or events.",
        )

    await db.commit()
    await stream_processor.refresh_known_persons()

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()
    return _build_person_response(person, embeddings)


@router.get("/{person_id}/photos", response_model=list[PersonPhotoItem])
async def get_person_photos(
    person_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("persons:view")),
):
    """Get all reference photos and embedding IDs for a person."""
    if getattr(_user, "role", None) and _user.role.name == "supervisor":
        return []

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    emb_result = await db.execute(
        select(PersonEmbedding)
        .where(PersonEmbedding.person_id == person.id)
        .order_by(PersonEmbedding.id.asc())
    )
    embeddings = emb_result.scalars().all()
    return [
        PersonPhotoItem(
            id=e.id,
            url=f"/api/snapshots/ref_{Path(e.reference_photo_path).name}",
            created_at=e.created_at,
        )
        for e in embeddings
    ]


# ── Leave / Off-Duty Management ────────────────────────────────────

@router.get("/{person_id}/leaves", response_model=list[dict])
async def get_person_leaves(
    person_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:view")),
):
    """Get all scheduled leaves and off-duty days for a person (scoped)."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به اطلاعات این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    leaves = getattr(person, "leaves", None) or []
    return leaves


@router.post("/{person_id}/leaves", response_model=list[dict], status_code=status.HTTP_201_CREATED)
async def create_person_leave(
    person_id: int,
    data: LeaveCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:edit")),
):
    """Add a leave / off-duty record for a person (scoped for supervisors)."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به ویرایش این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    current_leaves = list(getattr(person, "leaves", None) or [])
    new_leave = {
        "id": str(uuid.uuid4())[:8],
        "start_date": data.start_date.strip(),
        "end_date": data.end_date.strip(),
        "leave_type": data.leave_type.strip(),
        "note": (data.note or "").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": getattr(_user, "full_name", None) or getattr(_user, "username", "supervisor"),
    }
    current_leaves.append(new_leave)
    person.leaves = current_leaves
    await db.commit()
    await db.refresh(person)
    await stream_processor.refresh_zones()
    return person.leaves


@router.delete("/{person_id}/leaves/{leave_id}", response_model=list[dict])
async def delete_person_leave(
    person_id: int,
    leave_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("persons:edit")),
):
    """Cancel / remove a scheduled leave or off-duty record."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به ویرایش این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    current_leaves = list(getattr(person, "leaves", None) or [])
    updated_leaves = [l for l in current_leaves if l.get("id") != leave_id]
    person.leaves = updated_leaves
    await db.commit()
    await db.refresh(person)
    await stream_processor.refresh_zones()
    return person.leaves


@router.delete("/{person_id}/photos/{photo_id}")
async def delete_person_photo(
    person_id: int,
    photo_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("persons:edit")),
):
    """Delete a specific reference photo and its face embedding."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    emb_result = await db.execute(
        select(PersonEmbedding).where(
            and_(PersonEmbedding.id == photo_id, PersonEmbedding.person_id == person.id)
        )
    )
    embedding = emb_result.scalar_one_or_none()
    if not embedding:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Delete physical reference photo file
    try:
        Path(embedding.reference_photo_path).unlink(missing_ok=True)
    except Exception as e:
        logger.warning("Failed to delete reference photo file: %s", e)

    await db.delete(embedding)
    await db.commit()

    # Refresh the known persons cache in stream processor
    await stream_processor.refresh_known_persons()

    # Query remaining count
    count_res = await db.execute(
        select(func.count(PersonEmbedding.id)).where(PersonEmbedding.person_id == person.id)
    )
    remaining_count = count_res.scalar() or 0

    logger.info(
        "Deleted photo id=%d for person id=%d (remaining: %d)",
        photo_id,
        person_id,
        remaining_count,
    )

    return {
        "success": True,
        "deleted_photo_id": photo_id,
        "remaining_count": remaining_count,
    }


@router.get("/{person_id}/analytics", response_model=PersonAnalyticsResponse)
async def get_person_analytics(
    person_id: int,
    days: Optional[int] = Query(30, ge=1, le=365),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("persons:view")),
):
    """
    Get in-depth analytics, shift punctuality compliance, 24-hour activity
    distribution, daily attendance log, and camera distribution for a person.
    Scoped to assigned personnel and strictly Zero-Photo for supervisors.
    """
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به آمار تحلیلی این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    is_sup = bool(getattr(_user, "role", None) and _user.role.name == "supervisor")

    # Fetch reference photos (strictly redacted for supervisors - Zero-Photo privacy)
    if is_sup:
        ref_photos = []
    else:
        emb_result = await db.execute(
            select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
        )
        embeddings = emb_result.scalars().all()
        ref_photos = [
            f"/api/snapshots/ref_{Path(e.reference_photo_path).name}"
            for e in embeddings
        ]

    # Fetch cameras
    cameras_result = await db.execute(select(Camera))
    camera_map = {c.id: c.name for c in cameras_result.scalars().all()}

    # Fetch all zones to find assigned shifts
    zones_result = await db.execute(select(CameraZone))
    all_zones = zones_result.scalars().all()

    person_zones = [
        z for z in all_zones
        if person.id in [int(x) for x in _parse_list_field(z.assigned_person_ids, []) if str(x).isdigit()]
    ]

    shifts_info: list[PersonShiftInfo] = []
    for z in person_zones:
        start_str = z.start_time or "00:00"
        end_str = z.end_time or "23:59"
        active_days = _parse_list_field(z.active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
        in_sched = is_time_in_timetable(start_str, end_str, active_days)

        try:
            sh, sm = map(int, start_str.split(":"))
            eh, em = map(int, end_str.split(":"))
            start_m = sh * 60 + sm
            end_m = eh * 60 + em
            if end_m >= start_m:
                dur_h = round((end_m - start_m) / 60.0, 1)
            else:
                dur_h = round(((24 * 60 - start_m) + end_m) / 60.0, 1)
        except Exception:
            dur_h = 8.0

        shifts_info.append(
            PersonShiftInfo(
                zone_id=z.id,
                zone_name=z.name,
                camera_id=z.camera_id,
                camera_name=camera_map.get(z.camera_id, f"Camera #{z.camera_id}"),
                start_time=start_str,
                end_time=end_str,
                active_days=active_days,
                is_in_schedule_now=in_sched,
                shift_duration_hours=dur_h,
            )
        )

    has_assigned_shift = len(shifts_info) > 0

    # Fetch all actual face detection events for this person (exclude alerts)
    events_res = await db.execute(
        select(Event)
        .where(
            Event.person_id == person_id,
            or_(
                Event.alert_type.is_(None),
                Event.alert_type.notin_(["absence_timeout", "camera_disconnected"]),
            )
        )
        .order_by(Event.timestamp.desc())
    )
    events = events_res.scalars().all()
    last_seen_ev = events[0] if events else None

    def is_in_shift(dt: datetime) -> bool:
        if not has_assigned_shift:
            return False
        local_dt = _to_local_dt(dt)
        dname = local_dt.strftime("%a")
        hm = local_dt.strftime("%H:%M")
        for s in shifts_info:
            if dname in s.active_days:
                if s.start_time <= s.end_time:
                    if s.start_time <= hm <= s.end_time:
                        return True
                else:
                    if hm >= s.start_time or hm <= s.end_time:
                        return True
        return False

    # 1. 24-hour activity distribution
    hourly_counts = {h: {"count": 0, "in_shift": 0} for h in range(24)}
    for ev in events:
        ldt = _to_local_dt(ev.timestamp)
        h = ldt.hour
        hourly_counts[h]["count"] += 1
        if is_in_shift(ev.timestamp):
            hourly_counts[h]["in_shift"] += 1

    hourly_distribution = [
        PersonHourlyActivity(
            hour=h,
            count=hourly_counts[h]["count"],
            in_shift_count=hourly_counts[h]["in_shift"],
        )
        for h in range(24)
    ]

    # 2. Camera distribution
    camera_counts: dict[int, int] = {}
    for ev in events:
        cid = ev.camera_id or 0
        camera_counts[cid] = camera_counts.get(cid, 0) + 1

    total_ev_count = len(events)
    camera_distribution: list[PersonCameraDistribution] = []
    for cid, cnt in sorted(camera_counts.items(), key=lambda x: x[1], reverse=True):
        cname = camera_map.get(cid, f"Camera #{cid}") if cid else "Unknown Camera"
        pct = round((cnt / total_ev_count) * 100, 1) if total_ev_count > 0 else 0.0
        camera_distribution.append(
            PersonCameraDistribution(
                camera_id=cid if cid else None,
                camera_name=cname,
                count=cnt,
                percentage=pct,
            )
        )

    # 3. Security alert statistics
    out_of_zone = sum(1 for ev in events if getattr(ev, "alert_type", "") == "out_of_zone")
    unauth = sum(1 for ev in events if getattr(ev, "alert_type", "") == "unauthorized_entry")
    absence = sum(1 for ev in events if getattr(ev, "alert_type", "") == "absence_timeout")
    alert_stats = PersonAlertStats(
        out_of_zone_count=out_of_zone,
        unauthorized_entry_count=unauth,
        absence_timeout_count=absence,
        total_alerts=out_of_zone + unauth + absence,
    )

    # 4. Daily activity & shift attendance analysis across requested time frame
    local_now = datetime.now()
    p_timeout = 2
    p_grace = 10
    p_free = []
    if person.custom_shift and isinstance(person.custom_shift, dict):
        p_timeout = person.custom_shift.get("absence_timeout_minutes") or 2
        p_grace = person.custom_shift.get("grace_period_minutes") or 10
        p_free = _parse_list_field(person.custom_shift.get("free_times"), [])
    elif person_zones:
        p_timeout = getattr(person_zones[0], "absence_timeout_minutes", 2) or 2
        p_grace = getattr(person_zones[0], "grace_period_minutes", 10) or 10
        p_free = _parse_list_field(person_zones[0].free_times, [])

    # Resolve target dates list (descending from end_date down to start_date)
    target_dates: list = []
    if start_date and end_date:
        try:
            s_d = datetime.strptime(start_date, "%Y-%m-%d").date()
            e_d = datetime.strptime(end_date, "%Y-%m-%d").date()
            if s_d > e_d:
                s_d, e_d = e_d, s_d
            delta_days = (e_d - s_d).days
            if delta_days > 365:
                s_d = e_d - timedelta(days=365)
                delta_days = 365
            target_dates = [e_d - timedelta(days=k) for k in range(delta_days + 1)]
        except Exception:
            n_days = min(365, max(1, days or 30))
            target_dates = [local_now.date() - timedelta(days=k) for k in range(n_days)]
    elif start_date:
        try:
            s_d = datetime.strptime(start_date, "%Y-%m-%d").date()
            e_d = local_now.date()
            if s_d > e_d:
                s_d = e_d
            delta_days = min(365, (e_d - s_d).days)
            target_dates = [e_d - timedelta(days=k) for k in range(delta_days + 1)]
        except Exception:
            n_days = min(365, max(1, days or 30))
            target_dates = [local_now.date() - timedelta(days=k) for k in range(n_days)]
    else:
        n_days = min(365, max(1, days or 30))
        target_dates = [local_now.date() - timedelta(days=k) for k in range(n_days)]

    daily_activity: list[PersonDailyActivity] = []

    scheduled_shift_days = 0
    present_shift_days = 0
    absent_shift_days = 0
    on_time_arrivals = 0
    late_arrivals = 0
    total_delay_minutes = 0
    early_departures = 0
    total_early_minutes = 0
    overtime_days = 0
    in_shift_detections_total = 0
    out_of_shift_detections_total = 0

    for target_date in target_dates:
        i = (local_now.date() - target_date).days
        date_str = target_date.strftime("%Y-%m-%d")
        day_name = target_date.strftime("%a")

        # Check leave record for this person on target_date
        is_on_leave = False
        leave_record = None
        if person and getattr(person, "leaves", None):
            for l in person.leaves:
                if isinstance(l, dict):
                    s_date = str(l.get("start_date", "")).strip()
                    e_date = str(l.get("end_date", "")).strip() or s_date
                    if s_date <= date_str <= e_date:
                        is_on_leave = True
                        leave_record = l
                        break

        # Find matching shift for this day of week
        matching_shift = None
        if has_assigned_shift and not is_on_leave:
            for s in shifts_info:
                if day_name in s.active_days:
                    matching_shift = s
                    break

        is_sched_day = matching_shift is not None
        if is_sched_day:
            scheduled_shift_days += 1

        # Events for this local day
        day_events = [ev for ev in events if _to_local_dt(ev.timestamp).date() == target_date]
        day_events.sort(key=lambda ev: ev.timestamp)

        day_cnt = len(day_events)
        day_in_shift = 0
        for ev in day_events:
            if is_in_shift(ev.timestamp):
                day_in_shift += 1
                in_shift_detections_total += 1
            else:
                out_of_shift_detections_total += 1

        if day_cnt > 0:
            first_ev = day_events[0]
            last_ev = day_events[-1]
            first_ldt = _to_local_dt(first_ev.timestamp)
            last_ldt = _to_local_dt(last_ev.timestamp)
            first_time_str = first_ldt.strftime("%H:%M:%S")
            last_time_str = last_ldt.strftime("%H:%M:%S")

            dur_secs = max(0, int((last_ev.timestamp - first_ev.timestamp).total_seconds()))
            dur_str = _format_duration(dur_secs) if dur_secs > 0 else "< 1m"

            delay_mins = 0
            early_leave_mins = 0
            overtime_mins = 0

            if is_sched_day and matching_shift:
                present_shift_days += 1
                sh, sm = map(int, matching_shift.start_time.split(":"))
                arr_h, arr_m = first_ldt.hour, first_ldt.minute
                diff_arr = (arr_h * 60 + arr_m) - (sh * 60 + sm)
                if diff_arr <= 5:
                    arrival_status = "on_time"
                    on_time_arrivals += 1
                else:
                    arrival_status = "late"
                    delay_mins = diff_arr
                    late_arrivals += 1
                    total_delay_minutes += delay_mins

                eh, em = map(int, matching_shift.end_time.split(":"))
                dep_h, dep_m = last_ldt.hour, last_ldt.minute
                diff_dep = (eh * 60 + em) - (dep_h * 60 + dep_m)
                if diff_dep > 10:
                    departure_status = "left_early"
                    early_leave_mins = diff_dep
                    early_departures += 1
                    total_early_minutes += early_leave_mins
                elif (dep_h * 60 + dep_m) - (eh * 60 + em) >= 20:
                    departure_status = "overtime"
                    overtime_mins = (dep_h * 60 + dep_m) - (eh * 60 + em)
                    overtime_days += 1
                else:
                    departure_status = "normal"
            else:
                arrival_status = "off_schedule"
                departure_status = "overtime" if dur_secs >= 1800 else "normal"
                if dur_secs >= 1800:
                    overtime_days += 1

            day_alerts = sum(1 for ev in day_events if getattr(ev, "alert_type", "normal") not in ("normal", ""))

            # Primary camera
            c_tally: dict[int, int] = {}
            for ev in day_events:
                if ev.camera_id:
                    c_tally[ev.camera_id] = c_tally.get(ev.camera_id, 0) + 1
            top_c_id = max(c_tally.items(), key=lambda x: x[1])[0] if c_tally else None
            top_c_name = camera_map.get(top_c_id, f"Camera #{top_c_id}") if top_c_id else ""

            # Shift duration and absence from shift minutes
            shift_dur_mins = 0
            req_shift_mins = 0
            day_absence_mins = 0
            day_absence_str = "0m"
            day_absence_intervals: list[AbsenceInterval] = []

            if is_sched_day and matching_shift:
                try:
                    sh, sm = map(int, matching_shift.start_time.split(":"))
                    eh, em = map(int, matching_shift.end_time.split(":"))
                    start_m = sh * 60 + sm
                    end_m = eh * 60 + em
                    shift_dur_mins = (end_m - start_m) if end_m >= start_m else ((24 * 60 - start_m) + end_m)
                except Exception:
                    shift_dur_mins = 480

                # Determine expected required minutes up to now if shift is active today
                if target_date == local_now.date():
                    now_m = local_now.hour * 60 + local_now.minute
                    if end_m >= start_m:
                        if now_m < start_m:
                            req_shift_mins = 0
                        elif now_m >= end_m:
                            req_shift_mins = shift_dur_mins
                        else:
                            req_shift_mins = max(0, now_m - start_m)
                    else:
                        if now_m >= start_m:
                            req_shift_mins = max(0, now_m - start_m)
                        elif now_m < end_m:
                            req_shift_mins = min(shift_dur_mins, (24 * 60 - start_m) + now_m)
                        else:
                            req_shift_mins = shift_dur_mins
                else:
                    req_shift_mins = shift_dur_mins

                pres_mins = min(shift_dur_mins, max(0, dur_secs // 60))
                is_cam_offline = any(not stream_processor.is_camera_online(z.camera_id) for z in person_zones)
                if i == 0 and is_cam_offline:
                    day_absence_mins = 0
                else:
                    day_absence_mins = max(0, req_shift_mins - pres_mins)
                day_absence_str = _format_duration(day_absence_mins * 60)

                # Record distinct absence intervals
                if not (i == 0 and is_cam_offline):
                    # 1. Arrival delay
                    if delay_mins >= 3:
                        day_absence_intervals.append(
                            AbsenceInterval(
                                start_time=matching_shift.start_time,
                                end_time=first_ldt.strftime("%H:%M"),
                                duration_minutes=delay_mins,
                                duration_str=_format_duration(delay_mins * 60),
                                interval_type="late_arrival",
                            )
                        )
                    # 2. Gaps between sightings
                    for idx in range(len(day_events) - 1):
                        gap_sec = (day_events[idx + 1].timestamp - day_events[idx].timestamp).total_seconds()
                        gap_raw_mins = int(gap_sec // 60)
                        if gap_raw_mins >= p_timeout:
                            t1_loc = _to_local_dt(day_events[idx].timestamp).replace(tzinfo=None)
                            t2_loc = _to_local_dt(day_events[idx + 1].timestamp).replace(tzinfo=None)
                            free_gap = get_interval_free_minutes(t1_loc, t2_loc, p_free)
                            net_gap = max(0, gap_raw_mins - free_gap)
                            if net_gap >= p_timeout:
                                day_absence_intervals.append(
                                    AbsenceInterval(
                                        start_time=t1_loc.strftime("%H:%M"),
                                        end_time=t2_loc.strftime("%H:%M"),
                                        duration_minutes=net_gap,
                                        duration_str=_format_duration(net_gap * 60),
                                        interval_type="gap",
                                    )
                                )
                    # 3. Early departure
                    if early_leave_mins >= 3:
                        day_absence_intervals.append(
                            AbsenceInterval(
                                start_time=last_ldt.strftime("%H:%M"),
                                end_time=matching_shift.end_time,
                                duration_minutes=early_leave_mins,
                                duration_str=_format_duration(early_leave_mins * 60),
                                interval_type="early_leave",
                            )
                        )

            daily_activity.append(
                PersonDailyActivity(
                    date=date_str,
                    day_name=day_name,
                    is_scheduled_shift_day=is_sched_day,
                    shift_start_time=matching_shift.start_time if matching_shift else None,
                    shift_end_time=matching_shift.end_time if matching_shift else None,
                    shift_duration_minutes=req_shift_mins,
                    absence_from_shift_minutes=day_absence_mins,
                    absence_from_shift_str=day_absence_str,
                    absence_count=len(day_absence_intervals),
                    absence_intervals=day_absence_intervals,
                    detections_count=day_cnt,
                    in_shift_detections=day_in_shift,
                    first_seen_time=first_time_str,
                    last_seen_time=last_time_str,
                    arrival_status=arrival_status,
                    delay_minutes=delay_mins,
                    departure_status=departure_status,
                    early_leave_minutes=early_leave_mins,
                    overtime_minutes=overtime_mins,
                    estimated_duration_seconds=dur_secs,
                    estimated_duration_str=dur_str,
                    alerts_count=day_alerts,
                    primary_camera=top_c_name,
                )
            )
        else:
            shift_dur_mins = 0
            req_shift_mins = 0
            day_absence_intervals = []
            if is_sched_day and matching_shift:
                is_cam_offline = any(not stream_processor.is_camera_online(z.camera_id) for z in person_zones)
                if i == 0 and is_cam_offline:
                    arr_stat = "camera_offline"
                    day_absence_mins = 0
                    day_absence_str = "0m"
                else:
                    absent_shift_days += 1
                    arr_stat = "absent"
                    try:
                        sh, sm = map(int, matching_shift.start_time.split(":"))
                        eh, em = map(int, matching_shift.end_time.split(":"))
                        start_m = sh * 60 + sm
                        end_m = eh * 60 + em
                        shift_dur_mins = (end_m - start_m) if end_m >= start_m else ((24 * 60 - start_m) + end_m)
                    except Exception:
                        shift_dur_mins = 480

                    if target_date == local_now.date():
                        now_m = local_now.hour * 60 + local_now.minute
                        if end_m >= start_m:
                            if now_m < start_m:
                                req_shift_mins = 0
                            elif now_m >= end_m:
                                req_shift_mins = shift_dur_mins
                            else:
                                req_shift_mins = max(0, now_m - start_m)
                        else:
                            if now_m >= start_m:
                                req_shift_mins = max(0, now_m - start_m)
                            elif now_m < end_m:
                                req_shift_mins = min(shift_dur_mins, (24 * 60 - start_m) + now_m)
                            else:
                                req_shift_mins = shift_dur_mins
                    else:
                        req_shift_mins = shift_dur_mins

                    day_absence_mins = req_shift_mins
                    day_absence_str = _format_duration(day_absence_mins * 60)
                    if req_shift_mins > 0:
                        day_absence_intervals.append(
                            AbsenceInterval(
                                start_time=matching_shift.start_time,
                                end_time=matching_shift.end_time,
                                duration_minutes=req_shift_mins,
                                duration_str=day_absence_str,
                                interval_type="unseen",
                            )
                        )
            elif is_on_leave:
                arr_stat = "on_leave"
                day_absence_mins = 0
                day_absence_str = "0m"
            else:
                arr_stat = "rest_day"
                day_absence_mins = 0
                day_absence_str = "0m"

            daily_activity.append(
                PersonDailyActivity(
                    date=date_str,
                    day_name=day_name,
                    is_scheduled_shift_day=is_sched_day,
                    shift_start_time=matching_shift.start_time if matching_shift else None,
                    shift_end_time=matching_shift.end_time if matching_shift else None,
                    shift_duration_minutes=req_shift_mins,
                    absence_from_shift_minutes=day_absence_mins,
                    absence_from_shift_str=day_absence_str,
                    absence_count=len(day_absence_intervals),
                    absence_intervals=day_absence_intervals,
                    detections_count=0,
                    in_shift_detections=0,
                    arrival_status=arr_stat,
                    departure_status="none",
                )
            )

    # 5. Shift Compliance & Total Absence calculations across time frame
    total_scheduled_shift_mins = sum(
        day.shift_duration_minutes
        for day in daily_activity
        if day.is_scheduled_shift_day and day.arrival_status not in ("on_leave", "rest_day", "camera_offline")
    )
    total_absence_mins = sum(
        day.absence_from_shift_minutes
        for day in daily_activity
        if day.is_scheduled_shift_day and day.arrival_status not in ("on_leave", "rest_day", "camera_offline")
    )

    if total_scheduled_shift_mins > 0:
        actual_presence_shift_mins = max(0, total_scheduled_shift_mins - total_absence_mins)
        compliance_rate = min(100.0, max(0.0, round((actual_presence_shift_mins / total_scheduled_shift_mins) * 100.0, 1)))
    else:
        compliance_rate = 100.0 if not has_assigned_shift else 100.0

    today_str = local_now.date().strftime("%Y-%m-%d")
    today_absence_mins = daily_activity[0].absence_from_shift_minutes if (daily_activity and daily_activity[0].date == today_str and daily_activity[0].is_scheduled_shift_day) else 0
    today_absence_hours_str = _format_duration(today_absence_mins * 60)

    week_absence_mins = sum(day.absence_from_shift_minutes for day in daily_activity[:7] if day.is_scheduled_shift_day)
    week_absence_hours_str = _format_duration(week_absence_mins * 60)

    month_absence_mins = sum(day.absence_from_shift_minutes for day in daily_activity[:30] if day.is_scheduled_shift_day)
    month_absence_hours_str = _format_duration(month_absence_mins * 60)

    total_absence_mins = sum(day.absence_from_shift_minutes for day in daily_activity if day.is_scheduled_shift_day)
    total_absence_hours_str = _format_duration(total_absence_mins * 60)

    today_presence_mins = (daily_activity[0].estimated_duration_seconds // 60) if (daily_activity and daily_activity[0].date == today_str and daily_activity[0].estimated_duration_seconds) else 0

    primary_shift_str = None
    if shifts_info:
        primary_shift_str = f"{shifts_info[0].start_time} - {shifts_info[0].end_time}"

    # Current absence minutes if in active shift and absent right now
    now_utc = datetime.now(timezone.utc)
    seconds_since = (now_utc - (last_seen_ev.timestamp if last_seen_ev and last_seen_ev.timestamp.tzinfo else last_seen_ev.timestamp.replace(tzinfo=timezone.utc))).total_seconds() if last_seen_ev and last_seen_ev.timestamp else 999999

    current_absence_mins = None
    current_status = "never_seen"
    in_shift_now = any(s.is_in_schedule_now for s in shifts_info) if has_assigned_shift else False
    in_free_now, _ = is_time_in_free_time(p_free, local_now)

    if last_seen_ev:
        if has_assigned_shift:
            if in_shift_now:
                is_cam_offline = any(not stream_processor.is_camera_online(z.camera_id) for z in person_zones)
                if is_cam_offline:
                    current_status = "camera_offline"
                    current_absence_mins = 0
                elif in_free_now:
                    current_status = "on_break"
                    current_absence_mins = 0
                elif seconds_since < (p_timeout * 60):
                    current_status = "present"
                    current_absence_mins = 0
                else:
                    last_ev_loc = _to_local_dt(last_seen_ev.timestamp).replace(tzinfo=None)
                    free_since = get_interval_free_minutes(last_ev_loc, local_now, p_free)
                    net_missing = max(0, int(seconds_since // 60) - free_since)
                    if net_missing < p_timeout:
                        current_status = "present"
                        current_absence_mins = 0
                    else:
                        current_status = "absent"
                        current_absence_mins = net_missing
            else:
                current_status = "off_duty"
        else:
            current_status = "present" if seconds_since < (p_timeout * 60) else "off_duty"
    else:
        # Never seen yet
        if has_assigned_shift and in_shift_now:
            # Check if within arrival grace period
            matching_s = next((s for s in shifts_info if s.is_in_schedule_now), None)
            if matching_s:
                try:
                    sh, sm = map(int, matching_s.start_time.split(":"))
                    elapsed_arr = max(0, (local_now.hour * 60 + local_now.minute) - (sh * 60 + sm))
                except Exception:
                    elapsed_arr = 999
                if in_free_now:
                    current_status = "on_break"
                    current_absence_mins = 0
                elif elapsed_arr <= p_grace:
                    current_status = "present"
                    current_absence_mins = 0
                else:
                    current_status = "absent"
                    current_absence_mins = elapsed_arr

    absence_count_today = daily_activity[0].absence_count if (daily_activity and daily_activity[0].date == today_str and daily_activity[0].is_scheduled_shift_day) else 0
    today_absence_intervals = daily_activity[0].absence_intervals if (daily_activity and daily_activity[0].date == today_str and daily_activity[0].is_scheduled_shift_day) else []

    shift_compliance = PersonShiftCompliance(
        has_assigned_shift=has_assigned_shift,
        primary_shift_time=primary_shift_str,
        current_absence_minutes=current_absence_mins,
        today_absence_minutes=today_absence_mins,
        today_absence_hours_str=today_absence_hours_str,
        absence_count_today=absence_count_today,
        today_absence_intervals=today_absence_intervals,
        week_absence_minutes=week_absence_mins,
        week_absence_hours_str=week_absence_hours_str,
        month_absence_minutes=month_absence_mins,
        month_absence_hours_str=month_absence_hours_str,
        total_absence_minutes=total_absence_mins,
        total_absence_hours_str=total_absence_hours_str,
        scheduled_shift_days=scheduled_shift_days,
        present_shift_days=present_shift_days,
        absent_shift_days=absent_shift_days,
        on_time_arrivals=on_time_arrivals,
        late_arrivals=late_arrivals,
        total_delay_minutes=total_delay_minutes,
        early_departures=early_departures,
        total_early_minutes=total_early_minutes,
        overtime_days=overtime_days,
        compliance_rate=compliance_rate,
        in_shift_detections=in_shift_detections_total,
        out_of_shift_detections=out_of_shift_detections_total,
    )

    # 6. Overall summary stats
    today_start_utc = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_utc = now_utc - timedelta(days=7)
    month_start_utc = now_utc - timedelta(days=30)

    today_cnt = sum(1 for ev in events if ev.timestamp and (ev.timestamp if ev.timestamp.tzinfo else ev.timestamp.replace(tzinfo=timezone.utc)) >= today_start_utc)
    week_cnt = sum(1 for ev in events if ev.timestamp and (ev.timestamp if ev.timestamp.tzinfo else ev.timestamp.replace(tzinfo=timezone.utc)) >= week_start_utc)
    month_cnt = sum(1 for ev in events if ev.timestamp and (ev.timestamp if ev.timestamp.tzinfo else ev.timestamp.replace(tzinfo=timezone.utc)) >= month_start_utc)

    first_seen_dt = events[-1].timestamp if events else None
    last_seen_dt = last_seen_ev.timestamp if last_seen_ev else None

    conf_scores = [ev.confidence_score for ev in events if ev.confidence_score is not None]
    avg_conf = round(float(sum(conf_scores) / len(conf_scores) * 100), 1) if conf_scores else 0.0
    max_conf = round(float(max(conf_scores) * 100), 1) if conf_scores else 0.0
    min_conf = round(float(min(conf_scores) * 100), 1) if conf_scores else 0.0

    top_cam_dict = None
    if camera_distribution:
        top_cam_dict = {
            "id": camera_distribution[0].camera_id,
            "name": camera_distribution[0].camera_name,
            "count": camera_distribution[0].count,
            "percentage": camera_distribution[0].percentage,
        }

    top_zone_dict = None
    zone_tally: dict[str, int] = {}
    for ev in events:
        zn = getattr(ev, "zone_name", "")
        if zn:
            zone_tally[zn] = zone_tally.get(zn, 0) + 1
    if zone_tally:
        z_sorted = sorted(zone_tally.items(), key=lambda x: x[1], reverse=True)
        top_zone_dict = {"name": z_sorted[0][0], "count": z_sorted[0][1]}

    summary_stats = PersonSummaryStats(
        total_detections=len(events),
        today_detections=today_cnt,
        week_detections=week_cnt,
        month_detections=month_cnt,
        first_seen=first_seen_dt,
        last_seen=last_seen_dt,
        last_seen_camera=camera_map.get(last_seen_ev.camera_id, f"Camera #{last_seen_ev.camera_id}") if last_seen_ev and last_seen_ev.camera_id else None,
        last_seen_zone=getattr(last_seen_ev, "zone_name", None) if last_seen_ev else None,
        last_seen_snapshot_url=(
            None if is_sup else (f"/api/snapshots/{last_seen_ev.snapshot_path}" if last_seen_ev and last_seen_ev.snapshot_path else None)
        ),
        avg_confidence=avg_conf,
        max_confidence=max_conf,
        min_confidence=min_conf,
        top_camera=top_cam_dict,
        top_zone=top_zone_dict,
        current_status=current_status,
        assigned_zones_count=len(person_zones),
        primary_shift_time=primary_shift_str,
        current_absence_minutes=current_absence_mins,
        today_absence_minutes=today_absence_mins,
        today_absence_hours_str=today_absence_hours_str,
        week_absence_minutes=week_absence_mins,
        week_absence_hours_str=week_absence_hours_str,
        month_absence_minutes=month_absence_mins,
        month_absence_hours_str=month_absence_hours_str,
        today_presence_minutes=today_presence_mins,
    )

    # 7. Recent events list (up to 15) - Redacted for supervisors
    recent_event_responses: list[EventResponse] = []
    for ev in events[:15]:
        ts = ev.timestamp
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        recent_event_responses.append(
            EventResponse(
                id=ev.id,
                timestamp=ts,
                camera_id=ev.camera_id,
                camera_name=camera_map.get(ev.camera_id, f"Camera #{ev.camera_id}") if ev.camera_id else "Camera",
                person_id=person.id,
                person_name=person.name,
                confidence_score=ev.confidence_score or 0.0,
                snapshot_path="" if is_sup else (ev.snapshot_path or ""),
                snapshot_url="" if is_sup else (f"/api/snapshots/{ev.snapshot_path}" if ev.snapshot_path else ""),
                is_known=True,
                zone_id=getattr(ev, "zone_id", None),
                zone_name=getattr(ev, "zone_name", "") or "",
                alert_type=getattr(ev, "alert_type", "normal") or "normal",
                duration_seconds=getattr(ev, "duration_seconds", None),
            )
        )

    return PersonAnalyticsResponse(
        person_id=person.id,
        name=person.name,
        role=person.role or "",
        enrolled_at=person.created_at,
        reference_photos=ref_photos,
        summary=summary_stats,
        shifts=shifts_info,
        shift_compliance=shift_compliance,
        hourly_distribution=hourly_distribution,
        daily_activity_last_14_days=daily_activity,
        camera_distribution=camera_distribution,
        alerts=alert_stats,
        recent_events=recent_event_responses,
    )


@router.get("/{person_id}/analytics/export")
async def export_person_analytics(
    person_id: int,
    format: str = Query("xlsx", pattern="^(xlsx|csv)$"),
    days: Optional[int] = Query(30, ge=1, le=365),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("persons:view")),
):
    """
    Export an executive, zero-photo attendance & compliance analytics report
    for an individual person across the requested time frame (Excel .xlsx or CSV).
    Strictly scoped to assigned persons for supervisors.
    """
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به گزارش تحلیلی این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    analytics = await get_person_analytics(
        person_id=person_id,
        days=days,
        start_date=start_date,
        end_date=end_date,
        db=db,
        _user=_user,
    )

    analytics_dict = analytics.model_dump()
    s_date = start_date or (analytics.daily_activity_last_14_days[-1].date if analytics.daily_activity_last_14_days else "")
    e_date = end_date or (analytics.daily_activity_last_14_days[0].date if analytics.daily_activity_last_14_days else "")

    if format == "csv":
        content = generate_person_analytics_csv(
            analytics=analytics_dict,
            person_name=person.name,
            role=person.role or "",
            section=person.section or "",
            start_date_str=s_date,
            end_date_str=e_date,
        )
        filename = f"analytics_{person_id}_{s_date}_to_{e_date}.csv"
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        content = generate_person_analytics_xlsx(
            analytics=analytics_dict,
            person_name=person.name,
            role=person.role or "",
            section=person.section or "",
            start_date_str=s_date,
            end_date_str=e_date,
        )
        filename = f"analytics_{person_id}_{s_date}_to_{e_date}.xlsx"
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


@router.post("/reindex-embeddings")
async def reindex_person_embeddings(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("persons:edit")),
) -> dict[str, Any]:
    """
    Recompute face embeddings for all persons from stored reference photos
    using the currently active InsightFace model (e.g. when switching between buffalo_l and buffalo_s).
    """
    result = await db.execute(
        select(PersonEmbedding, Person.name)
        .join(Person, Person.id == PersonEmbedding.person_id)
    )
    rows = result.all()

    if not rows:
        return {"success": True, "updated": 0, "failed": 0, "message": "No embeddings to re-index."}

    updated_count = 0
    failed_count = 0

    for emb, _name in rows:
        photo_path = Path(emb.reference_photo_path)
        if not photo_path.exists():
            failed_count += 1
            continue

        try:
            img_bytes = photo_path.read_bytes()
            new_vec = face_engine.extract_embedding_from_photo(img_bytes)
            if new_vec is not None:
                emb.embedding = new_vec.tolist()
                updated_count += 1
            else:
                failed_count += 1
        except Exception as e:
            logger.warning("Failed to re-index photo %s: %s", photo_path, e)
            failed_count += 1

    if updated_count > 0:
        await db.commit()
        await stream_processor.refresh_known_persons()

    return {
        "success": True,
        "model": settings.insightface_model,
        "updated": updated_count,
        "failed": failed_count,
        "message": f"Successfully re-indexed {updated_count} embeddings using model '{settings.insightface_model}'.",
    }


# ═══════════════════════════════════════════════════════════
# Person Shift & Timetable Management
# ═══════════════════════════════════════════════════════════

@router.get("/{person_id}/shift", response_model=PersonShiftManageResponse)
async def get_person_shift_config(
    person_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_any_permission("duty:view", "persons:view", "persons:edit")),
):
    """Retrieve full shift schedule, assigned workstations/zones, and timetable for a person."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به شیفت این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Fetch shift template if linked
    tmpl = None
    if person.shift_template_id:
        tmpl = await db.get(ShiftTemplate, person.shift_template_id)

    # Fetch all zones to find workstation assignments
    zones_res = await db.execute(select(CameraZone))
    all_zones = zones_res.scalars().all()

    cams_res = await db.execute(select(Camera))
    cam_map = {c.id: c.name for c in cams_res.scalars().all()}

    assigned_zones: list[PersonShiftZoneInfo] = []
    for z in all_zones:
        # If user is scoped (supervisor), only include assigned zones that belong to cameras within supervisor's scope
        if scope.is_scoped and not scope.can_access_camera(z.camera_id):
            continue
        pids = [int(x) for x in _parse_list_field(z.assigned_person_ids, []) if str(x).isdigit()]
        if person.id in pids:
            assigned_zones.append(
                PersonShiftZoneInfo(
                    id=z.id,
                    name=z.name,
                    camera_id=z.camera_id,
                    camera_name=cam_map.get(z.camera_id, f"Camera #{z.camera_id}"),
                    start_time=z.start_time or "00:00",
                    end_time=z.end_time or "23:59",
                    active_days=_parse_list_field(z.active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
                )
            )

    # Determine effective shift
    effective_shift = None
    if person.custom_shift:
        c_shift = person.custom_shift
        is_rot = c_shift.get("shift_type") in ("rotational", "rotation")
        rot_state = None
        if is_rot and c_shift.get("rotation_pattern"):
            rot_state = get_rotation_day_state(c_shift["rotation_pattern"])
        effective_shift = {
            "type": "custom",
            "name": c_shift.get("name") or "شیفت سفارشی",
            **c_shift,
            "rotation_state": rot_state,
        }
    elif tmpl:
        is_rot = getattr(tmpl, "shift_type", "fixed") in ("rotational", "rotation")
        rot_state = None
        if is_rot and tmpl.rotation_pattern:
            rot_state = get_rotation_day_state(tmpl.rotation_pattern)
        effective_shift = {
            "type": "template",
            "id": tmpl.id,
            "name": tmpl.name,
            "shift_type": getattr(tmpl, "shift_type", "fixed"),
            "rotation_pattern": getattr(tmpl, "rotation_pattern", None),
            "rotation_state": rot_state,
            "start_time": tmpl.start_time,
            "end_time": tmpl.end_time,
            "color": tmpl.color,
            "active_days": _parse_list_field(tmpl.active_days, []),
            "grace_period_minutes": tmpl.grace_period_minutes,
            "absence_timeout_minutes": tmpl.absence_timeout_minutes,
            "free_times": _parse_list_field(tmpl.free_times, []),
        }
    elif assigned_zones:
        pz = assigned_zones[0]
        effective_shift = {
            "type": "zone",
            "name": pz.name,
            "start_time": pz.start_time,
            "end_time": pz.end_time,
            "active_days": pz.active_days,
        }

    return PersonShiftManageResponse(
        person_id=person.id,
        person_name=person.name,
        role=person.role or "",
        section=person.section or "",
        shift_template_id=person.shift_template_id,
        shift_template=ShiftTemplateResponse.model_validate(tmpl) if tmpl else None,
        custom_shift=person.custom_shift,
        effective_shift=effective_shift,
        assigned_zones=assigned_zones,
    )


@router.put("/{person_id}/shift", response_model=PersonShiftManageResponse)
async def update_person_shift_config(
    person_id: int,
    data: PersonShiftManageRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_any_permission("duty:manage", "persons:edit")),
):
    """Update section, shift template, custom hours, and workstation assignments for a person."""
    scope = await get_user_scope(_user, db)
    if not scope.can_access_person(person_id):
        raise HTTPException(status_code=403, detail="دسترسی به مدیریت شیفت این فرد برای شما مجاز نیست.")

    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if data.section is not None:
        person.section = data.section.strip()

    if "shift_template_id" in data.model_fields_set:
        if data.shift_template_id and data.shift_template_id > 0:
            tmpl = await db.get(ShiftTemplate, data.shift_template_id)
            if not tmpl:
                raise HTTPException(status_code=400, detail="الگوی شیفت انتخاب‌شده نامعتبر است.")
            person.shift_template_id = data.shift_template_id
            person.custom_shift = None
        else:
            person.shift_template_id = None

    if "custom_shift" in data.model_fields_set:
        person.custom_shift = data.custom_shift
        if data.custom_shift:
            person.shift_template_id = None

    # Synchronize camera zone workstation assignments
    if data.assigned_zone_ids is not None:
        target_zone_ids = set(data.assigned_zone_ids)
        zones_res = await db.execute(select(CameraZone))
        all_zones = zones_res.scalars().all()

        # If user is scoped (supervisor), validate that all target zones belong to cameras in supervisor's scope
        if scope.is_scoped and scope.camera_ids is not None:
            zone_cam_map = {z.id: z.camera_id for z in all_zones}
            for zid in target_zone_ids:
                cam_id = zone_cam_map.get(zid)
                if cam_id is not None and not scope.can_access_camera(cam_id):
                    # Check if this person was ALREADY assigned to this outside zone (preservation)
                    z_obj = next((z for z in all_zones if z.id == zid), None)
                    prev_pids = [int(x) for x in _parse_list_field(z_obj.assigned_person_ids, []) if str(x).isdigit()] if z_obj else []
                    if person_id not in prev_pids:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="شما فقط مجاز به انتساب ایستگاه‌های کاری دوربین‌های تخصیص‌یافته به خود هستید.",
                        )

        for z in all_zones:
            # If user is scoped, only modify assignments for cameras in supervisor's scope
            if scope.is_scoped and not scope.can_access_camera(z.camera_id):
                continue

            current_pids = [int(x) for x in _parse_list_field(z.assigned_person_ids, []) if str(x).isdigit()]
            if z.id in target_zone_ids and person_id not in current_pids:
                current_pids.append(person_id)
                z.assigned_person_ids = current_pids
            elif z.id not in target_zone_ids and person_id in current_pids:
                current_pids = [pid for pid in current_pids if pid != person_id]
                z.assigned_person_ids = current_pids

    await db.commit()
    await db.refresh(person)

    # Refresh stream processor zone caches
    await stream_processor.refresh_zones()

    logger.info("Updated shift schedule and stations for person id=%d ('%s')", person.id, person.name)
    return await get_person_shift_config(person_id=person.id, db=db, _user=_user)



