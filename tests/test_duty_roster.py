"""
Tests for the Live Duty Roster endpoint (/api/zones/duty-roster).
"""

import time
from datetime import datetime, timezone, timedelta
import pytest
import pytest_asyncio
from httpx import AsyncClient

from backend.main import app
from backend.models import Person, Camera, CameraZone, Event, ShiftTemplate
from backend.routers.zones import get_shift_window
from backend.stream_processor import stream_processor
from tests.test_api import test_session, test_engine, client, setup_database


@pytest.mark.asyncio
async def test_duty_roster_empty(client: AsyncClient):
    """When no zones exist, duty roster should return empty list with valid aggregates."""
    resp = await client.get("/api/zones/duty-roster")
    assert resp.status_code == 200
    data = resp.json()
    assert "server_time" in data
    assert data["total_on_duty"] == 0
    assert data["present_count"] == 0
    assert data["absent_count"] == 0
    assert data["total_shift_absence_minutes"] == 0
    assert data["roster"] == []


@pytest.mark.asyncio
async def test_duty_roster_with_active_shift_absent(client: AsyncClient, monkeypatch):
    """When a person is assigned to an active shift and not seen in zone, they are marked absent."""
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    async with test_session() as session:
        # Create Camera
        cam = Camera(name="Main Gate", rtsp_url="rtsp://127.0.0.1/live", location="Lobby", is_active=True)
        session.add(cam)
        await session.flush()

        # Create Person
        p = Person(name="David Guard", role="Security Guard")
        session.add(p)
        await session.flush()

        # Create Zone with 24/7 active shift timetable (00:00 - 23:59)
        zone = CameraZone(
            camera_id=cam.id,
            name="Gate Booth",
            x=10, y=10, width=200, height=200,
            alert_mode="absence",
            assigned_person_ids=[p.id],
            start_time="00:00",
            end_time="23:59",
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            absence_timeout_minutes=5,
            free_times=[],
            is_active=True,
        )
        session.add(zone)
        await session.commit()
        await session.refresh(p)
        await session.refresh(zone)
        pid = p.id
        zid = zone.id

    # Clear stream processor cache for this zone/person
    stream_processor._zone_last_seen.pop((zid, pid), None)

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_on_duty"] == 1
    assert data["absent_count"] == 1
    assert data["present_count"] == 0
    assert len(data["roster"]) == 1

    item = data["roster"][0]
    assert item["person_id"] == pid
    assert item["person_name"] == "David Guard"
    assert item["person_role"] == "Security Guard"
    assert item["zone_name"] == "Gate Booth"
    assert item["is_in_duty_hours"] is True
    assert item["status"] == "absent"
    assert item["is_in_zone"] is False
    assert item["absence_timeout_minutes"] == 5
    assert item["current_absence_minutes"] >= 0
    assert item["shift_absence_minutes"] >= 0
    assert item["shift_window_str"] == "00:00 - 23:59"
    assert item["absence_type"] == "not_arrived"


@pytest.mark.asyncio
async def test_duty_roster_with_active_shift_present(client: AsyncClient, monkeypatch):
    """When a person has a recent detection in zone, they are marked present with 0 current absence."""
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    async with test_session() as session:
        cam = Camera(name="Station Desk", rtsp_url="rtsp://127.0.0.1/stream2", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Sarah Connor", role="Inspector")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Inspection Desk",
            x=0, y=0, width=150, height=150,
            assigned_person_ids=[p.id],
            start_time="00:00",
            end_time="23:59",
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            absence_timeout_minutes=3,
            is_active=True,
        )
        session.add(zone)
        await session.commit()
        await session.refresh(p)
        await session.refresh(zone)
        pid = p.id
        zid = zone.id

    # Simulate recent sighting (15 seconds ago) in stream processor
    stream_processor._zone_last_seen[(zid, pid)] = time.time() - 15.0

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_on_duty"] >= 1
    sarah = next((r for r in data["roster"] if r["person_id"] == pid), None)
    assert sarah is not None
    assert sarah["status"] == "present"
    assert sarah["is_in_zone"] is True
    assert sarah["current_absence_minutes"] == 0
    assert sarah["last_seen_seconds_ago"] is not None
    assert sarah["last_seen_seconds_ago"] >= 14.0


@pytest.mark.asyncio
async def test_duty_roster_with_scheduled_break(client: AsyncClient, monkeypatch):
    """When current time falls inside a configured free time/break, status is marked on_break."""
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    async with test_session() as session:
        cam = Camera(name="Break Room Cam", rtsp_url="rtsp://127.0.0.1/break", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Chef Mario", role="Head Chef")
        session.add(p)
        await session.flush()

        # Free time that covers 24/7 (00:00 - 23:59)
        zone = CameraZone(
            camera_id=cam.id,
            name="Kitchen Station",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time="00:00",
            end_time="23:59",
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            absence_timeout_minutes=4,
            free_times=[{"name": "Lunch Break", "start_time": "00:00", "end_time": "23:59"}],
            is_active=True,
        )
        session.add(zone)
        await session.commit()
        await session.refresh(p)
        await session.refresh(zone)
        pid = p.id
        zid = zone.id

    # Not seen recently
    stream_processor._zone_last_seen.pop((zid, pid), None)

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    mario = next((r for r in data["roster"] if r["person_id"] == pid), None)
    assert mario is not None
    assert mario["status"] == "on_break"
    assert mario["is_in_free_time"] is True
    assert mario["current_break_name"] == "Lunch Break"
    assert mario["current_absence_minutes"] == 0
    assert data["on_break_count"] >= 1


@pytest.mark.asyncio
async def test_zone_crud_and_editing(client: AsyncClient):
    """Test creating, editing (updating), and fetching zone with absence timer and free times."""
    async with test_session() as session:
        cam = Camera(name="Warehouse Cam", rtsp_url="rtsp://127.0.0.1/wh", is_active=True)
        session.add(cam)
        p = Person(name="Worker Bob", role="Operator")
        session.add(p)
        await session.commit()
        await session.refresh(cam)
        await session.refresh(p)
        cam_id = cam.id
        pid = p.id

    # 1. Create Zone
    create_payload = {
        "camera_id": cam_id,
        "name": "Loading Bay Zone",
        "x": 10.0,
        "y": 10.0,
        "width": 50.0,
        "height": 50.0,
        "alert_mode": "absence",
        "assigned_person_ids": [pid],
        "start_time": "08:00",
        "end_time": "17:00",
        "active_days": ["Mon", "Tue", "Wed"],
        "absence_timeout_minutes": 7,
        "free_times": [
            {"name": "Lunch", "start_time": "12:00", "end_time": "13:00"},
            {"name": "Tea", "start_time": "15:00", "end_time": "15:20"},
        ],
    }
    resp = await client.post(f"/api/cameras/{cam_id}/zones", json=create_payload)
    assert resp.status_code == 201
    created = resp.json()
    zid = created["id"]
    assert created["name"] == "Loading Bay Zone"
    assert created["absence_timeout_minutes"] == 7
    assert len(created["free_times"]) == 2
    assert created["free_times"][0]["name"] == "Lunch"

    # 2. Edit Zone (PUT /api/zones/{zone_id})
    update_payload = {
        "name": "Updated Loading Bay",
        "x": 15.0,
        "y": 15.0,
        "width": 60.0,
        "height": 60.0,
        "absence_timeout_minutes": 10,
        "free_times": [
            {"name": "Extended Lunch", "start_time": "12:00", "end_time": "13:30"},
        ],
    }
    update_resp = await client.put(f"/api/zones/{zid}", json=update_payload)
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Updated Loading Bay"
    assert updated["absence_timeout_minutes"] == 10
    assert len(updated["free_times"]) == 1
    assert updated["free_times"][0]["name"] == "Extended Lunch"
    assert updated["x"] == 15.0
    assert updated["width"] == 60.0


def test_get_shift_window_intra_day():
    """Verify get_shift_window for standard daytime shift (e.g. 08:00 - 17:00)."""
    # Reference: Monday 10:00 (active)
    ref = datetime(2026, 10, 19, 10, 0, 0)  # Monday
    in_sched, w_start, w_end, is_overnight, dur_h, elapsed = get_shift_window(
        "08:00", "17:00", ["Mon", "Tue"], ref
    )
    assert in_sched is True
    assert is_overnight is False
    assert dur_h == 9.0
    assert elapsed == 120
    assert w_start == datetime(2026, 10, 19, 8, 0, 0)
    assert w_end == datetime(2026, 10, 19, 17, 0, 0)

    # Reference: Sunday 10:00 (inactive day)
    ref_sun = datetime(2026, 10, 18, 10, 0, 0)  # Sunday
    in_sched_sun, _, _, is_overnight_sun, _, _ = get_shift_window(
        "08:00", "17:00", ["Mon", "Tue"], ref_sun
    )
    assert in_sched_sun is False
    assert is_overnight_sun is False


def test_get_shift_window_overnight_cross_midnight():
    """
    Verify get_shift_window for overnight shifts (e.g. 22:00 - 06:00).
    Origin day is Monday; it should span into Tuesday morning.
    """
    # 1. Monday at 23:00 (before midnight, origin day is Monday)
    ref_mon_night = datetime(2026, 10, 19, 23, 0, 0)  # Monday
    in_sched, w_start, w_end, is_overnight, dur_h, elapsed = get_shift_window(
        "22:00", "06:00", ["Mon", "Wed"], ref_mon_night
    )
    assert in_sched is True
    assert is_overnight is True
    assert dur_h == 8.0
    assert elapsed == 60
    assert w_start == datetime(2026, 10, 19, 22, 0, 0)
    assert w_end == datetime(2026, 10, 20, 6, 0, 0)

    # 2. Tuesday at 03:00 (after midnight, origin day was Monday!)
    ref_tue_early = datetime(2026, 10, 20, 3, 0, 0)  # Tuesday 03:00
    in_sched, w_start, w_end, is_overnight, dur_h, elapsed = get_shift_window(
        "22:00", "06:00", ["Mon", "Wed"], ref_tue_early
    )
    assert in_sched is True
    assert is_overnight is True
    assert dur_h == 8.0
    assert elapsed == 300  # 5 hours elapsed from Monday 22:00
    assert w_start == datetime(2026, 10, 19, 22, 0, 0)
    assert w_end == datetime(2026, 10, 20, 6, 0, 0)

    # 3. Wednesday at 03:00 (origin day was Tuesday, but Tuesday is NOT active!)
    ref_wed_early = datetime(2026, 10, 21, 3, 0, 0)  # Wednesday 03:00
    in_sched, _, _, is_overnight, _, _ = get_shift_window(
        "22:00", "06:00", ["Mon", "Wed"], ref_wed_early
    )
    assert in_sched is False
    assert is_overnight is True

    # 4. Tuesday at 12:00 (midday, completely outside the overnight shift)
    ref_tue_noon = datetime(2026, 10, 20, 12, 0, 0)
    in_sched, _, _, is_overnight, _, _ = get_shift_window(
        "22:00", "06:00", ["Mon", "Wed"], ref_tue_noon
    )
    assert in_sched is False
    assert is_overnight is True


@pytest.mark.asyncio
async def test_shift_templates_crud_api(client: AsyncClient):
    """Test CRUD REST endpoints for Shift Templates (/api/shift-templates)."""
    # 1. POST: Create a new custom shift template
    payload = {
        "name": "Custom Factory Night Shift",
        "start_time": "23:00",
        "end_time": "07:00",
        "color": "#8b5cf6",
        "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed"],
        "grace_period_minutes": 15,
        "absence_timeout_minutes": 5,
        "free_times": [
            {"name": "Tea Break", "start_time": "02:00", "end_time": "02:30"}
        ]
    }
    create_resp = await client.post("/api/shift-templates", json=payload)
    assert create_resp.status_code == 201
    created = create_resp.json()
    tid = created["id"]
    assert created["name"] == "Custom Factory Night Shift"
    assert created["start_time"] == "23:00"
    assert created["end_time"] == "07:00"
    assert created["grace_period_minutes"] == 15
    assert len(created["free_times"]) == 1

    # 2. GET: Verify created template appears in list
    resp = await client.get("/api/shift-templates")
    assert resp.status_code == 200
    templates = resp.json()
    assert isinstance(templates, list)
    assert any(t["id"] == tid for t in templates)

    # 3. GET by ID
    get_resp = await client.get(f"/api/shift-templates/{tid}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == tid

    # 4. PUT: Update shift template
    update_payload = {
        "name": "Updated Night Shift",
        "grace_period_minutes": 20
    }
    update_resp = await client.put(f"/api/shift-templates/{tid}", json=update_payload)
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Updated Night Shift"
    assert updated["grace_period_minutes"] == 20
    assert updated["start_time"] == "23:00"  # preserved

    # 5. DELETE: Delete shift template
    del_resp = await client.delete(f"/api/shift-templates/{tid}")
    assert del_resp.status_code == 204

    # 6. Verify 404 after deletion
    get_after = await client.get(f"/api/shift-templates/{tid}")
    assert get_after.status_code == 404


@pytest.mark.asyncio
async def test_camera_zone_with_shift_attributes(client: AsyncClient):
    """Test creating and updating a CameraZone with shift_name, grace_period_minutes, and shifts."""
    async with test_session() as session:
        cam = Camera(name="Gate Cam", rtsp_url="rtsp://127.0.0.1/gate", is_active=True)
        session.add(cam)
        p = Person(name="Guard Alex", role="Security")
        session.add(p)
        await session.commit()
        await session.refresh(cam)
        await session.refresh(p)
        cam_id = cam.id
        pid = p.id

    create_payload = {
        "camera_id": cam_id,
        "name": "Security Checkpoint",
        "x": 0.0,
        "y": 0.0,
        "width": 100.0,
        "height": 100.0,
        "start_time": "22:00",
        "end_time": "06:00",
        "shift_name": "Overnight Security",
        "grace_period_minutes": 12,
        "shifts": [
            {
                "name": "Night Shift A",
                "start_time": "22:00",
                "end_time": "06:00",
                "assigned_person_ids": [pid],
                "grace_period_minutes": 12,
            }
        ],
        "assigned_person_ids": [pid],
        "active_days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    }
    resp = await client.post(f"/api/cameras/{cam_id}/zones", json=create_payload)
    assert resp.status_code == 201
    zone_data = resp.json()
    zid = zone_data["id"]
    assert zone_data["shift_name"] == "Overnight Security"
    assert zone_data["grace_period_minutes"] == 12
    assert len(zone_data["shifts"]) == 1

    # Update zone grace period and shifts
    update_payload = {
        "grace_period_minutes": 18,
        "shift_name": "Updated Overnight Security",
    }
    up_resp = await client.put(f"/api/zones/{zid}", json=update_payload)
    assert up_resp.status_code == 200
    updated_data = up_resp.json()
    assert updated_data["grace_period_minutes"] == 18
    assert updated_data["shift_name"] == "Updated Overnight Security"


@pytest.mark.asyncio
async def test_duty_roster_arrival_within_grace_period(client: AsyncClient, monkeypatch):
    """
    When a person arrives slightly late but WITHIN the arrival grace period:
    - is_within_grace_period is True
    - arrival_delay_minutes > 0
    - No late_arrival interval is registered in absence_intervals
    - shift_absence_minutes is 0
    """
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    now_local = datetime.now()
    # Construct a shift that started 8 minutes ago and ends in 2 hours
    shift_start_dt = now_local - timedelta(minutes=8)
    shift_end_dt = now_local + timedelta(hours=2)
    s_start_str = shift_start_dt.strftime("%H:%M")
    s_end_str = shift_end_dt.strftime("%H:%M")

    async with test_session() as session:
        cam = Camera(name="Grace Cam", rtsp_url="rtsp://127.0.0.1/grace", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Alice Early", role="Assembler")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Assembly Line 1",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time=s_start_str,
            end_time=s_end_str,
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            grace_period_minutes=15,  # 15 minutes grace period
            absence_timeout_minutes=5,
            is_active=True,
        )
        session.add(zone)
        await session.flush()

        # Create sighting event at 5 minutes after shift start (which is <= 15 min grace)
        event_time = shift_start_dt + timedelta(minutes=5)
        ev = Event(
            camera_id=cam.id,
            zone_id=zone.id,
            person_id=p.id,
            person_name=p.name,
            timestamp=event_time.astimezone(timezone.utc),
            confidence_score=0.95,
            snapshot_path="/snapshots/test_alice.jpg",
            alert_type="normal",
        )
        session.add(ev)
        await session.commit()
        pid = p.id
        zid = zone.id

    # Sighted right now
    stream_processor._zone_last_seen[(zid, pid)] = time.time() - 5.0

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    alice = next((r for r in data["roster"] if r["person_id"] == pid), None)
    assert alice is not None
    assert alice["is_in_duty_hours"] is True
    assert alice["grace_period_minutes"] == 15
    assert alice["is_within_grace_period"] is True
    assert alice["arrival_delay_minutes"] == 5
    # Since arrival was within grace period, no late arrival interval should be logged
    late_intervals = [i for i in alice["absence_intervals"] if i["interval_type"] == "late_arrival"]
    assert len(late_intervals) == 0
    assert alice["shift_absence_minutes"] == 0


@pytest.mark.asyncio
async def test_duty_roster_arrival_exceeding_grace_period(client: AsyncClient, monkeypatch):
    """
    When a person arrives late EXCEEDING the arrival grace period:
    - is_within_grace_period is False
    - arrival_delay_minutes > grace_period
    - late_arrival interval is logged with duration = delay
    - shift_absence_minutes reflects the late arrival duration
    """
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    now_local = datetime.now()
    # Shift started 30 minutes ago, ends in 2 hours
    shift_start_dt = now_local - timedelta(minutes=30)
    shift_end_dt = now_local + timedelta(hours=2)
    s_start_str = shift_start_dt.strftime("%H:%M")
    s_end_str = shift_end_dt.strftime("%H:%M")

    async with test_session() as session:
        cam = Camera(name="Late Cam", rtsp_url="rtsp://127.0.0.1/late", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Bob Late", role="Welder")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Welding Bay",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time=s_start_str,
            end_time=s_end_str,
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            grace_period_minutes=10,  # 10 minutes grace period
            absence_timeout_minutes=5,
            is_active=True,
        )
        session.add(zone)
        await session.flush()

        # Person first arrived at 25 minutes after shift start (exceeds 10 min grace period!)
        event_time = shift_start_dt + timedelta(minutes=25)
        ev = Event(
            camera_id=cam.id,
            zone_id=zone.id,
            person_id=p.id,
            person_name=p.name,
            timestamp=event_time.astimezone(timezone.utc),
            confidence_score=0.92,
            snapshot_path="/snapshots/test_bob.jpg",
            alert_type="normal",
        )
        session.add(ev)
        await session.commit()
        pid = p.id
        zid = zone.id

    # Sighted right now
    stream_processor._zone_last_seen[(zid, pid)] = time.time() - 5.0

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    bob = next((r for r in data["roster"] if r["person_id"] == pid), None)
    assert bob is not None
    assert bob["is_in_duty_hours"] is True
    assert bob["grace_period_minutes"] == 10
    assert bob["is_within_grace_period"] is False
    assert bob["arrival_delay_minutes"] == 25
    late_intervals = [i for i in bob["absence_intervals"] if i["interval_type"] == "late_arrival"]
    assert len(late_intervals) == 1
    assert late_intervals[0]["duration_minutes"] == 25
    assert bob["shift_absence_minutes"] >= 25


@pytest.mark.asyncio
async def test_server_reset_person_not_seen_entire_shift(client: AsyncClient, monkeypatch):
    """
    When the server resets mid-shift and a person has never been seen during the shift:
    - They must NOT be marked as 'In Zone (just now)' or present.
    - Status must be 'absent' and 'Not Seen Yet'.
    - Absence minutes must count from shift start, not from server reset.
    """
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    now_local = datetime.now()
    # Shift started 2 hours ago (120 mins), ends in 2 hours
    shift_start_dt = now_local - timedelta(minutes=120)
    shift_end_dt = now_local + timedelta(hours=2)
    s_start_str = shift_start_dt.strftime("%H:%M")
    s_end_str = shift_end_dt.strftime("%H:%M")

    async with test_session() as session:
        cam = Camera(name="Gate Cam", rtsp_url="rtsp://127.0.0.1/gate", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Siavash Reset", role="Guard")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Security Booth",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time=s_start_str,
            end_time=s_end_str,
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            grace_period_minutes=10,
            absence_timeout_minutes=5,
            is_active=True,
        )
        session.add(zone)
        await session.commit()
        pid = p.id
        zid = zone.id

    # Simulate server reset: _zone_last_seen has no entries or 0 for this person
    stream_processor._zone_last_seen.pop((zid, pid), None)

    # 1. Check live status endpoint
    resp = await client.get("/api/zones/status")
    assert resp.status_code == 200
    z_live = next((z for z in resp.json() if z["zone_id"] == zid), None)
    assert z_live is not None
    p_status = next((st for st in z_live["assigned_persons"] if st["person_id"] == pid), None)
    assert p_status is not None
    assert p_status["status"] == "absent"
    assert p_status["last_seen_str"] == "Not Seen Yet"
    assert p_status["last_seen_seconds_ago"] is None
    # Absence minutes must be ~120 mins (from shift start), not 0
    assert p_status["minutes_absent"] is not None
    assert 118 <= p_status["minutes_absent"] <= 122

    # 2. Check duty roster endpoint
    resp_roster = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp_roster.status_code == 200
    data_roster = resp_roster.json()
    p_roster = next((r for r in data_roster["roster"] if r["person_id"] == pid), None)
    assert p_roster is not None
    assert p_roster["is_in_zone"] is False
    assert p_roster["status"] == "absent"
    assert p_roster["last_seen_str"] == "Not Seen Yet"
    assert 118 <= p_roster["current_absence_minutes"] <= 122
    assert p_roster["shift_absence_minutes"] >= 118


@pytest.mark.asyncio
async def test_server_reset_populates_last_seen_from_db_when_sighting_exists(client: AsyncClient, monkeypatch):
    """
    When the server resets mid-shift and a person was sighted before the restart,
    stream_processor.refresh_zones() should restore their last sighting timestamp from DB.
    """
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    now_local = datetime.now()
    shift_start_dt = now_local - timedelta(minutes=90)
    shift_end_dt = now_local + timedelta(hours=3)

    async with test_session() as session:
        cam = Camera(name="Front Cam", rtsp_url="rtsp://127.0.0.1/front", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Alice Seen", role="Officer")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Front Area",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time=shift_start_dt.strftime("%H:%M"),
            end_time=shift_end_dt.strftime("%H:%M"),
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            is_active=True,
        )
        session.add(zone)
        await session.flush()

        # Add physical sighting event 20 minutes ago
        seen_time = now_local - timedelta(minutes=20)
        ev = Event(
            camera_id=cam.id,
            zone_id=zone.id,
            person_id=p.id,
            person_name=p.name,
            timestamp=seen_time.astimezone(timezone.utc),
            confidence_score=0.95,
            snapshot_path="/snapshots/test_alice.jpg",
            alert_type="normal",
        )
        session.add(ev)
        await session.commit()
        pid = p.id
        zid = zone.id
        expected_ts = seen_time.timestamp()

    # Clear memory cache to simulate reboot
    stream_processor._zone_last_seen.pop((zid, pid), None)

    # Call refresh_zones
    await stream_processor.refresh_zones()

    # Verify last seen was restored from DB
    restored_ts = stream_processor._zone_last_seen.get((zid, pid))
    assert restored_ts is not None
    assert abs(restored_ts - expected_ts) < 5.0  # within 5 seconds of the event timestamp


@pytest.mark.asyncio
async def test_duty_roster_suppress_absence_when_under_absence_timeout(client: AsyncClient, monkeypatch):
    """
    When person was seen 2 minutes ago and absence_timeout_minutes is 5:
    - They must NOT be shown as absent.
    - Status must be 'present', current_absence_minutes must be 0.
    """
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    now_local = datetime.now()
    shift_start_dt = now_local - timedelta(minutes=60)
    shift_end_dt = now_local + timedelta(hours=3)

    async with test_session() as session:
        cam = Camera(name="Gate Alpha", rtsp_url="rtsp://127.0.0.1/alpha", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Timer Grace Worker", role="Operator")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Alpha Station",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time=shift_start_dt.strftime("%H:%M"),
            end_time=shift_end_dt.strftime("%H:%M"),
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            grace_period_minutes=10,
            absence_timeout_minutes=5,  # 5 minutes threshold
            is_active=True,
        )
        session.add(zone)
        await session.commit()
        pid = p.id
        zid = zone.id

    # Sighted 2 minutes ago (120s ago, which is < 5 min threshold)
    stream_processor._zone_last_seen[(zid, pid)] = time.time() - 120.0

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    item = next((r for r in data["roster"] if r["person_id"] == pid), None)
    assert item is not None
    assert item["status"] == "present"
    assert item["is_in_zone"] is True
    assert item["current_absence_minutes"] == 0

    # Also check /api/zones/status
    resp_status = await client.get("/api/zones/status")
    assert resp_status.status_code == 200
    z_st = next((z for z in resp_status.json() if z["zone_id"] == zid), None)
    assert z_st is not None
    p_st = next((st for st in z_st["assigned_persons"] if st["person_id"] == pid), None)
    assert p_st is not None
    assert p_st["status"] == "present"
    assert p_st["minutes_absent"] == 0


@pytest.mark.asyncio
async def test_duty_roster_suppress_absence_during_arrival_grace_period(client: AsyncClient, monkeypatch):
    """
    When shift started 5 minutes ago, arrival grace is 15 mins, and person hasn't arrived yet:
    - They must NOT be shown as absent.
    - Status must be 'present' (within grace period).
    - current_absence_minutes = 0, shift_absence_minutes = 0, no absence intervals.
    """
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    now_local = datetime.now()
    # Shift started 5 minutes ago, ends in 4 hours
    shift_start_dt = now_local - timedelta(minutes=5)
    shift_end_dt = now_local + timedelta(hours=4)

    async with test_session() as session:
        cam = Camera(name="Entry Gate", rtsp_url="rtsp://127.0.0.1/entry", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Late Arriving Worker", role="Technician")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Entry Checkpoint",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time=shift_start_dt.strftime("%H:%M"),
            end_time=shift_end_dt.strftime("%H:%M"),
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            grace_period_minutes=15,  # 15 minutes grace period
            absence_timeout_minutes=5,
            is_active=True,
        )
        session.add(zone)
        await session.commit()
        pid = p.id
        zid = zone.id

    # Not seen yet in this shift
    stream_processor._zone_last_seen.pop((zid, pid), None)

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    item = next((r for r in data["roster"] if r["person_id"] == pid), None)
    assert item is not None
    assert item["status"] == "present"
    assert item["is_within_grace_period"] is True
    assert item["current_absence_minutes"] == 0
    assert item["shift_absence_minutes"] == 0
    assert item["absence_count"] == 0
    assert len(item["absence_intervals"]) == 0

    # Also check /api/zones/status
    resp_status = await client.get("/api/zones/status")
    assert resp_status.status_code == 200
    z_st = next((z for z in resp_status.json() if z["zone_id"] == zid), None)
    assert z_st is not None
    p_st = next((st for st in z_st["assigned_persons"] if st["person_id"] == pid), None)
    assert p_st is not None
    assert p_st["status"] == "present"
    assert p_st["minutes_absent"] == 0


@pytest.mark.asyncio
async def test_duty_roster_deducts_scheduled_break_from_gap_absence(client: AsyncClient, monkeypatch):
    """
    When detections have a 45-minute gap that occurs entirely during a scheduled 45-minute lunch break:
    - That gap must NOT be counted as an absence window.
    - shift_absence_minutes must be 0.
    """
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)
    now_local = datetime.now()
    # Shift started 120 minutes ago
    shift_start_dt = now_local - timedelta(minutes=120)
    shift_end_dt = now_local + timedelta(hours=3)

    # Break was from 90 mins ago to 45 mins ago (45 minutes duration)
    break_start_dt = now_local - timedelta(minutes=90)
    break_end_dt = now_local - timedelta(minutes=45)

    async with test_session() as session:
        cam = Camera(name="Factory Bay", rtsp_url="rtsp://127.0.0.1/bay", is_active=True)
        session.add(cam)
        await session.flush()

        p = Person(name="Lunch Worker", role="Mechanic")
        session.add(p)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Main Bay",
            x=0, y=0, width=100, height=100,
            assigned_person_ids=[p.id],
            start_time=shift_start_dt.strftime("%H:%M"),
            end_time=shift_end_dt.strftime("%H:%M"),
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            grace_period_minutes=10,
            absence_timeout_minutes=5,
            free_times=[{
                "name": "Lunch",
                "start_time": break_start_dt.strftime("%H:%M"),
                "end_time": break_end_dt.strftime("%H:%M"),
            }],
            is_active=True,
        )
        session.add(zone)
        await session.flush()

        # Event 1: right as break started
        ev1 = Event(
            camera_id=cam.id,
            zone_id=zone.id,
            person_id=p.id,
            person_name=p.name,
            timestamp=break_start_dt.astimezone(timezone.utc),
            confidence_score=0.92,
            snapshot_path="/snapshots/test_lunch1.jpg",
            alert_type="normal",
        )
        # Event 2: right as break ended
        ev2 = Event(
            camera_id=cam.id,
            zone_id=zone.id,
            person_id=p.id,
            person_name=p.name,
            timestamp=break_end_dt.astimezone(timezone.utc),
            confidence_score=0.93,
            snapshot_path="/snapshots/test_lunch2.jpg",
            alert_type="normal",
        )
        session.add(ev1)
        session.add(ev2)
        await session.commit()
        pid = p.id
        zid = zone.id

    # Sighted right now
    stream_processor._zone_last_seen[(zid, pid)] = time.time() - 10.0

    resp = await client.get("/api/zones/duty-roster?only_active=true")
    assert resp.status_code == 200
    data = resp.json()
    item = next((r for r in data["roster"] if r["person_id"] == pid), None)
    assert item is not None
    assert item["status"] == "present"
    # The gap during break should NOT be logged as gap absence
    gap_intervals = [i for i in item["absence_intervals"] if i["interval_type"] == "gap"]
    assert len(gap_intervals) == 0
    assert item["current_absence_minutes"] == 0


