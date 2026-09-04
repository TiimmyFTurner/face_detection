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
from typing import Any
import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.face_engine import face_engine
from backend.models import Person, PersonEmbedding, Event, Camera, CameraZone
from backend.schemas import (
    PersonResponse,
    PersonUpdate,
    PersonAnalyticsResponse,
    PersonSummaryStats,
    PersonShiftInfo,
    PersonShiftCompliance,
    PersonDailyActivity,
    PersonHourlyActivity,
    PersonCameraDistribution,
    PersonAlertStats,
    EventResponse,
)
from backend.stream_processor import stream_processor
from backend.routers.zones import is_time_in_timetable, _parse_list_field

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
) -> dict:
    """Build a PersonResponse dict from ORM objects."""
    return {
        "id": person.id,
        "name": person.name,
        "role": person.role,
        "embedding_count": len(embeddings),
        "reference_photos": [
            f"/api/snapshots/ref_{Path(e.reference_photo_path).name}"
            for e in embeddings
        ],
        "created_at": person.created_at,
        "summary": summary,
    }


@router.get("", response_model=list[PersonResponse])
async def list_persons(db: AsyncSession = Depends(get_db)):
    """
    List all known persons with their embedding counts and high-level
    detection summary statistics (total detections, today's detections, last seen).
    """
    result = await db.execute(select(Person).order_by(Person.name))
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
                in_shift = any(
                    is_time_in_timetable(
                        z.start_time or "00:00",
                        z.end_time or "23:59",
                        _parse_list_field(z.active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
                    )
                    for z in person_zones
                )
                if in_shift:
                    if seconds_since < 180:
                        current_status = "present"
                    else:
                        current_status = "absent"
                        current_absence_mins = max(1, int(seconds_since // 60))
                else:
                    current_status = "off_duty"
        today_absence_mins = 0
        if person_zones:
            pz = person_zones[0]
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
                if current_status == "absent":
                    today_absence_mins = current_absence_mins or dur_m

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

        responses.append(_build_person_response(person, embeddings, summary))

    return responses


@router.post("", response_model=PersonResponse, status_code=status.HTTP_201_CREATED)
async def create_person(
    name: str = Form(...),
    role: str = Form(default=""),
    photos: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new known person by uploading one or more reference photos.
    Each photo is processed to extract a 512-d face embedding.
    """
    if not photos:
        raise HTTPException(
            status_code=400,
            detail="At least one reference photo is required.",
        )

    # Create person record
    person = Person(name=name, role=role)
    db.add(person)
    await db.commit()
    await db.refresh(person)

    # Process each reference photo
    embeddings_created: list[PersonEmbedding] = []

    for photo in photos:
        image_bytes = await photo.read()

        # Extract face embedding
        embedding = face_engine.extract_embedding_from_photo(image_bytes)

        if embedding is None:
            logger.warning(
                "No face detected in photo '%s' for person '%s'. Skipping.",
                photo.filename,
                name,
            )
            continue

        # Save reference photo to disk
        ext = Path(photo.filename or "photo.jpg").suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)

        with open(ref_path, "wb") as f:
            f.write(image_bytes)

        # Store embedding in database
        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        embeddings_created.append(person_emb)

    if not embeddings_created:
        # Rollback: delete the person if no valid embeddings were created
        await db.delete(person)
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail="No faces could be detected in any of the uploaded photos.",
        )

    await db.commit()

    # Refresh the known persons cache in the stream processor
    await stream_processor.refresh_known_persons()

    logger.info(
        "Person created: id=%d name='%s' embeddings=%d",
        person.id,
        name,
        len(embeddings_created),
    )

    return _build_person_response(person, embeddings_created)


@router.get("/{person_id}", response_model=PersonResponse)
async def get_person(person_id: int, db: AsyncSession = Depends(get_db)):
    """Get details for a specific person."""
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
):
    """Update a person's name or role."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if data.name is not None:
        person.name = data.name
    if data.role is not None:
        person.role = data.role

    await db.commit()
    await db.refresh(person)

    # Refresh cache
    await stream_processor.refresh_known_persons()

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()

    return _build_person_response(person, embeddings)


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_person(person_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a person and all their embeddings and reference photos."""
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
    photos: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Add additional reference photos for an existing person."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    added = 0

    for photo in photos:
        image_bytes = await photo.read()
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
            detail="No faces detected in any of the uploaded photos.",
        )

    await db.commit()
    await stream_processor.refresh_known_persons()

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()

    return _build_person_response(person, embeddings)


@router.get("/{person_id}/analytics", response_model=PersonAnalyticsResponse)
async def get_person_analytics(person_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get in-depth analytics, shift punctuality compliance, 24-hour activity
    distribution, 14-day attendance log, and camera distribution for a person.
    """
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Fetch reference photos
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

    # Fetch all events for this person
    events_res = await db.execute(
        select(Event)
        .where(Event.person_id == person_id)
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

    # 4. Daily activity & shift attendance analysis (last 14 days)
    local_now = datetime.now()
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

    for i in range(30):
        target_date = (local_now - timedelta(days=i)).date()
        date_str = target_date.strftime("%Y-%m-%d")
        day_name = target_date.strftime("%a")

        # Find matching shift for this day of week
        matching_shift = None
        if has_assigned_shift:
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
            day_absence_mins = 0
            day_absence_str = "0m"
            if is_sched_day and matching_shift:
                try:
                    sh, sm = map(int, matching_shift.start_time.split(":"))
                    eh, em = map(int, matching_shift.end_time.split(":"))
                    start_m = sh * 60 + sm
                    end_m = eh * 60 + em
                    shift_dur_mins = (end_m - start_m) if end_m >= start_m else ((24 * 60 - start_m) + end_m)
                except Exception:
                    shift_dur_mins = 480

                pres_mins = min(shift_dur_mins, max(0, dur_secs // 60))
                day_absence_mins = max(0, shift_dur_mins - pres_mins)
                day_absence_str = _format_duration(day_absence_mins * 60)

            daily_activity.append(
                PersonDailyActivity(
                    date=date_str,
                    day_name=day_name,
                    is_scheduled_shift_day=is_sched_day,
                    shift_start_time=matching_shift.start_time if matching_shift else None,
                    shift_end_time=matching_shift.end_time if matching_shift else None,
                    shift_duration_minutes=shift_dur_mins,
                    absence_from_shift_minutes=day_absence_mins,
                    absence_from_shift_str=day_absence_str,
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
            if is_sched_day and matching_shift:
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
                day_absence_mins = shift_dur_mins
                day_absence_str = _format_duration(shift_dur_mins * 60)
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
                    shift_duration_minutes=shift_dur_mins,
                    absence_from_shift_minutes=day_absence_mins,
                    absence_from_shift_str=day_absence_str,
                    detections_count=0,
                    in_shift_detections=0,
                    arrival_status=arr_stat,
                    departure_status="none",
                )
            )

    # 5. Shift Compliance & Total Absence calculations (Day / Week / Month)
    compliance_rate = round((present_shift_days / scheduled_shift_days) * 100.0, 1) if scheduled_shift_days > 0 else (100.0 if not has_assigned_shift else 0.0)

    today_absence_mins = daily_activity[0].absence_from_shift_minutes if daily_activity and daily_activity[0].is_scheduled_shift_day else 0
    today_absence_hours_str = _format_duration(today_absence_mins * 60)

    week_absence_mins = sum(day.absence_from_shift_minutes for day in daily_activity[:7] if day.is_scheduled_shift_day)
    week_absence_hours_str = _format_duration(week_absence_mins * 60)

    month_absence_mins = sum(day.absence_from_shift_minutes for day in daily_activity[:30] if day.is_scheduled_shift_day)
    month_absence_hours_str = _format_duration(month_absence_mins * 60)

    total_absence_mins = month_absence_mins
    total_absence_hours_str = month_absence_hours_str

    today_presence_mins = (daily_activity[0].estimated_duration_seconds // 60) if daily_activity and daily_activity[0].estimated_duration_seconds else 0

    primary_shift_str = None
    if shifts_info:
        primary_shift_str = f"{shifts_info[0].start_time} - {shifts_info[0].end_time}"

    # Current absence minutes if in active shift and absent right now
    now_utc = datetime.now(timezone.utc)
    seconds_since = (now_utc - (last_seen_ev.timestamp if last_seen_ev and last_seen_ev.timestamp.tzinfo else last_seen_ev.timestamp.replace(tzinfo=timezone.utc))).total_seconds() if last_seen_ev and last_seen_ev.timestamp else 999999

    current_absence_mins = None
    current_status = "never_seen"
    if last_seen_ev:
        if has_assigned_shift:
            in_shift_now = any(s.is_in_schedule_now for s in shifts_info)
            if in_shift_now:
                if seconds_since < 180:
                    current_status = "present"
                else:
                    current_status = "absent"
                    current_absence_mins = max(1, int(seconds_since // 60))
            else:
                current_status = "off_duty"
        else:
            current_status = "present" if seconds_since < 300 else "off_duty"

    shift_compliance = PersonShiftCompliance(
        has_assigned_shift=has_assigned_shift,
        primary_shift_time=primary_shift_str,
        current_absence_minutes=current_absence_mins,
        today_absence_minutes=today_absence_mins,
        today_absence_hours_str=today_absence_hours_str,
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
        last_seen_snapshot_url=f"/api/snapshots/{last_seen_ev.snapshot_path}" if last_seen_ev and last_seen_ev.snapshot_path else None,
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


    # 7. Recent events list (up to 15)
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
                snapshot_path=ev.snapshot_path or "",
                snapshot_url=f"/api/snapshots/{ev.snapshot_path}" if ev.snapshot_path else "",
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

