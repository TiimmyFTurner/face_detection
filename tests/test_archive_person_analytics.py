"""
Tests to verify that archived historical month data is transparently included in Person Analytics.
"""

import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest
from httpx import AsyncClient

from backend.config import settings
from backend.database import async_session
from backend.models import Person, Camera, CameraZone, Event
from backend.archive_manager import (
    get_archive_dir,
    init_archive_db,
    get_person_events_multi_db,
    get_person_latest_event_multi_db,
    invalidate_snapshot_cache,
)
from backend.routers.persons import _to_local_dt
from tests.test_api import client, test_session, setup_database


@pytest.fixture(autouse=True)
def setup_test_archive_env(tmp_path, monkeypatch):
    test_snap_dir = tmp_path / "snapshots"
    test_arch_dir = tmp_path / "archives"
    test_ref_dir = tmp_path / "reference_photos"

    test_snap_dir.mkdir(parents=True, exist_ok=True)
    test_arch_dir.mkdir(parents=True, exist_ok=True)
    test_ref_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(settings, "snapshot_dir", str(test_snap_dir))
    monkeypatch.setattr(settings, "archive_dir", str(test_arch_dir))
    monkeypatch.setattr(settings, "reference_photo_dir", str(test_ref_dir))

    invalidate_snapshot_cache()
    yield
    invalidate_snapshot_cache()


@pytest.mark.asyncio
async def test_get_person_events_multi_db_combines_active_and_archived():
    """Verify get_person_events_multi_db returns events from active DB and monthly archives."""
    # Create person first so foreign key succeeds
    async with test_session() as session:
        p = Person(name="Archived Worker", role="Worker")
        session.add(p)
        await session.commit()
        await session.refresh(p)
        pid = p.id

    # 1. Setup archive DB for 2026_09 (September 2026)
    arch_dir = Path(settings.archive_dir) / "2026_09"
    arch_dir.mkdir(parents=True, exist_ok=True)
    arch_db = arch_dir / "events_2026_09.db"
    init_archive_db(arch_db)

    with sqlite3.connect(str(arch_db)) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO events (id, timestamp, camera_id, person_id, person_name, confidence_score, snapshot_path, is_known, alert_type)
            VALUES (5001, '2026-09-15 08:30:00', 1, ?, 'Archived Worker', 0.95, 'snap_arch1.jpg', 1, 'normal'),
                   (5002, '2026-09-15 12:00:00', 1, ?, 'Archived Worker', 0.92, 'snap_arch2.jpg', 1, 'normal'),
                   (5003, '2026-09-15 12:05:00', 1, ?, 'Archived Worker', 0.0, 'snap_alert.jpg', 1, 'absence_timeout');
            """,
            (pid, pid, pid),
        )
        conn.commit()

    # 2. Add an event in active DB (October 2026)
    async with test_session() as session:
        active_ev = Event(
            id=6001,
            timestamp=datetime(2026, 10, 5, 9, 0, 0),
            camera_id=1,
            person_id=pid,
            person_name="Archived Worker",
            confidence_score=0.91,
            snapshot_path="snap_act1.jpg",
            is_known=True,
            alert_type="normal",
        )
        session.add(active_ev)
        await session.commit()

    try:
        async with test_session() as session:
            # Fetch all events (exclude system alerts like absence_timeout)
            events = await get_person_events_multi_db(
                db=session,
                person_id=pid,
                exclude_system_alerts=True,
            )

            # Should contain 3 events: 1 active (Oct 5) + 2 archived (Sep 15 12:00, Sep 15 08:30)
            # The absence_timeout alert should be excluded
            assert len(events) == 3
            # Check descending sorting
            assert events[0].id == 6001
            assert events[0].timestamp.month == 10
            assert events[1].id == 5002
            assert events[1].timestamp.month == 9
            assert events[2].id == 5001
            assert events[2].timestamp.month == 9

            # Test latest event helper
            latest = await get_person_latest_event_multi_db(session, pid)
            assert latest is not None
            assert latest.id == 6001

            # Test latest event helper when person ONLY exists in archive
            archived_only_pid = 8888
            with sqlite3.connect(str(arch_db)) as conn:
                conn.execute(
                    """
                    INSERT INTO events (id, timestamp, camera_id, person_id, person_name, confidence_score, snapshot_path, is_known, alert_type)
                    VALUES (5004, '2026-09-20 10:00:00', 2, ?, 'Past Person', 0.88, 'past.jpg', 1, 'normal');
                    """,
                    (archived_only_pid,),
                )
                conn.commit()

            latest_arch = await get_person_latest_event_multi_db(session, archived_only_pid)
            assert latest_arch is not None
            assert latest_arch.id == 5004
            assert latest_arch.person_name == "Past Person"

    finally:
        async with test_session() as session:
            ev_clean = await session.get(Event, 6001)
            if ev_clean:
                await session.delete(ev_clean)
                await session.commit()


@pytest.mark.asyncio
async def test_person_analytics_endpoint_includes_archived_month_data(client: AsyncClient):
    """
    Verify /api/persons/{id}/analytics includes archived month events in:
    - total_detections
    - daily_activity_last_14_days
    - attendance and absence calculations
    """
    local_now = datetime.now()

    # 1. Create a person and zone with shift
    async with test_session() as session:
        person = Person(name="Zahra Test", role="Operator")
        session.add(person)
        await session.flush()
        pid = person.id

        cam = Camera(name="Station Cam", rtsp_url="rtsp://test/station", is_active=True)
        session.add(cam)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Packaging Line",
            x=0.0,
            y=0.0,
            width=100.0,
            height=100.0,
            assigned_person_ids=[pid],
            start_time="07:00",
            end_time="15:00",
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        )
        session.add(zone)
        await session.commit()

    # 2. Pick a target date that falls 10 days ago (which we simulate as archived in previous month)
    target_archived_day = local_now.date() - timedelta(days=10)
    y = target_archived_day.year
    m = target_archived_day.month

    # Create archive DB for that month
    slug = f"{y:04d}_{m:02d}"
    arch_dir = Path(settings.archive_dir) / slug
    arch_dir.mkdir(parents=True, exist_ok=True)
    arch_db = arch_dir / f"events_{slug}.db"
    init_archive_db(arch_db)

    # Insert archived detection events for that day: ts1 and ts2 in UTC
    ts1 = datetime(target_archived_day.year, target_archived_day.month, target_archived_day.day, 7, 15, 0)
    ts2 = datetime(target_archived_day.year, target_archived_day.month, target_archived_day.day, 14, 45, 0)

    with sqlite3.connect(str(arch_db)) as conn:
        conn.execute(
            """
            INSERT INTO events (id, timestamp, camera_id, person_id, person_name, confidence_score, snapshot_path, is_known, alert_type)
            VALUES (8001, ?, 1, ?, 'Zahra Test', 0.94, 'arch_snap1.jpg', 1, 'normal'),
                   (8002, ?, 1, ?, 'Zahra Test', 0.96, 'arch_snap2.jpg', 1, 'normal');
            """,
            (ts1.isoformat(), pid, ts2.isoformat(), pid),
        )
        conn.commit()

    # 3. Call GET /api/persons/{pid}/analytics
    resp = await client.get(f"/api/persons/{pid}/analytics?days=14")
    assert resp.status_code == 200
    data = resp.json()

    # Total detections must count the archived detections
    assert data["summary"]["total_detections"] >= 2

    # Check the daily activity log for target_archived_day
    day_str = target_archived_day.strftime("%Y-%m-%d")
    daily_records = {d["date"]: d for d in data["daily_activity_last_14_days"]}
    assert day_str in daily_records

    rec = daily_records[day_str]
    # In the archived day, detections must be 2 (not 0!)
    assert rec["detections_count"] == 2
    # Arrival status must NOT be "absent" because she was seen!
    assert rec["arrival_status"] != "absent"
    expected_first_seen_local = _to_local_dt(ts1).strftime("%H:%M:%S")
    expected_last_seen_local = _to_local_dt(ts2).strftime("%H:%M:%S")
    assert rec["first_seen_time"] == expected_first_seen_local
    assert rec["last_seen_time"] == expected_last_seen_local
    # Presence span should be > 0
    assert rec["estimated_duration_seconds"] > 0
