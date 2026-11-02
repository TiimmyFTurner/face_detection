"""
Tests for preserving pre-break absence and presence telemetry when person is on legal break / free time.

Verifies:
  1. A person who never arrived before break keeps their pre-break absence duration,
     intervals, and low compliance even while status is 'on_break'.
  2. A person who worked right up to break has their pre-break useful presence preserved (not 0),
     0 shift absence, and 100% compliance.
  3. Pre-break absence intervals end at the start of the break.
"""

from datetime import datetime, timezone, timedelta
import pytest
from httpx import AsyncClient

from backend.models import Camera, CameraZone, Person, Event, Role, User
from backend.auth import get_current_user
from backend.stream_processor import stream_processor
from tests.test_api import test_session, client, setup_database


async def mock_admin_user():
    admin_role = Role(name="admin", display_name="Admin", permissions=["*"])
    return User(
        id=1,
        username="admin",
        full_name="System Administrator",
        is_active=True,
        role=admin_role,
        custom_permissions=["*"],
    )


@pytest.mark.asyncio
async def test_pre_break_absence_preserved_during_break(client: AsyncClient, monkeypatch):
    from backend.main import app
    app.dependency_overrides[get_current_user] = mock_admin_user
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)

    now_local = datetime.now()
    now_hm = now_local.hour * 60 + now_local.minute

    # Setup a break that covers now
    break_start_m = max(0, now_hm - 30)
    break_end_m = min(1439, now_hm + 30)
    b_start_str = f"{break_start_m // 60:02d}:{break_start_m % 60:02d}"
    b_end_str = f"{break_end_m // 60:02d}:{break_end_m % 60:02d}"

    # Setup shift that started 2 hours before the break
    shift_start_m = max(0, break_start_m - 120)
    shift_end_m = min(1439, break_end_m + 60)
    s_start_str = f"{shift_start_m // 60:02d}:{shift_start_m % 60:02d}"
    s_end_str = f"{shift_end_m // 60:02d}:{shift_end_m % 60:02d}"

    try:
        async with test_session() as session:
            cam = Camera(name="Test Cam Break", rtsp_url="rtsp://127.0.0.1/break_cam", is_active=True)
            session.add(cam)
            await session.flush()

            # Person 1: Never arrived (Zahra scenario)
            p_absent = Person(name="Zahra Unseen", role="Operator")
            # Person 2: Diligent worker who worked up to break
            p_present = Person(name="Siavash Diligent", role="Operator")
            session.add_all([p_absent, p_present])
            await session.flush()

            zone = CameraZone(
                name="Packaging Line",
                camera_id=cam.id,
                x=0,
                y=0,
                width=100,
                height=100,
                assigned_person_ids=[p_absent.id, p_present.id],
                start_time=s_start_str,
                end_time=s_end_str,
                active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                absence_timeout_minutes=5,
                grace_period_minutes=10,
                free_times=[{"name": "Lunch Break", "start_time": b_start_str, "end_time": b_end_str}],
                is_active=True,
            )
            session.add(zone)
            await session.commit()
            await session.refresh(zone)
            p_absent_id = p_absent.id
            p_present_id = p_present.id
            zid = zone.id

        # Person 1 was NOT seen in shift
        stream_processor._zone_last_seen.pop((zid, p_absent_id), None)

        # Person 2 was seen right before the break (e.g. 2 mins before break start)
        break_start_dt = now_local.replace(hour=break_start_m // 60, minute=break_start_m % 60, second=0)
        sight_time = break_start_dt - timedelta(minutes=2)
        sight_ts = sight_time.timestamp()
        stream_processor._zone_last_seen[(zid, p_present_id)] = sight_ts

        # Add detection events for Person 2 (regularly present before break)
        shift_start_dt = now_local.replace(hour=shift_start_m // 60, minute=shift_start_m % 60, second=0)
        async with test_session() as session:
            curr_t = shift_start_dt + timedelta(minutes=2)
            while curr_t < break_start_dt:
                ev = Event(
                    camera_id=cam.id,
                    person_id=p_present_id,
                    person_name="Siavash Diligent",
                    timestamp=curr_t.astimezone(timezone.utc),
                    snapshot_path="dummy.jpg",
                    alert_type="normal",
                )
                session.add(ev)
                curr_t += timedelta(minutes=4)
            await session.commit()

        resp = await client.get("/api/zones/duty-roster?only_active=true")
        assert resp.status_code == 200
        data = resp.json()

        roster = data["roster"]
        z_duty = next((r for r in roster if r["person_id"] == p_absent_id), None)
        s_duty = next((r for r in roster if r["person_id"] == p_present_id), None)

        assert z_duty is not None
        assert s_duty is not None

        # Both are currently on break
        assert z_duty["status"] == "on_break"
        assert s_duty["status"] == "on_break"
        assert z_duty["is_in_free_time"] is True
        assert s_duty["is_in_free_time"] is True
        assert z_duty["current_absence_minutes"] == 0
        assert s_duty["current_absence_minutes"] == 0

        # Person 1 (Zahra): Pre-break absence MUST be preserved!
        # Expected work time before break: approx 120 minutes
        assert z_duty["shift_absence_minutes"] >= 100, f"Expected ~120m absence, got {z_duty['shift_absence_minutes']}"
        assert z_duty["shift_compliance_pct"] == 0.0, f"Expected 0% compliance, got {z_duty['shift_compliance_pct']}"
        assert z_duty["absence_count"] >= 1, "Expected at least 1 absence interval for unseen worker"
        assert len(z_duty["absence_intervals"]) >= 1
        # Absence interval should end at break start
        assert z_duty["absence_intervals"][0]["end_time"] == b_start_str

        # Person 2 (Siavash): Worked all morning up to break!
        # Pre-break useful presence MUST be preserved!
        assert s_duty["shift_absence_minutes"] == 0
        assert s_duty["shift_presence_minutes"] >= 100, f"Expected ~120m presence, got {s_duty['shift_presence_minutes']}"
        assert s_duty["shift_compliance_pct"] == 100.0
        assert s_duty["absence_count"] == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)
