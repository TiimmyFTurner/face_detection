"""
Tests for camera disconnection isolation and scoping.
Ensures camera offline events are never attributed to individual personnel,
and scoped supervisors only see camera offline events for their own assigned cameras.
"""

from datetime import datetime, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from backend.models import Camera, CameraZone, Person, Event, Role, User
from backend.auth import get_current_user
from backend.main import app
from tests.test_api import test_session, client, setup_database, mock_admin


@pytest.mark.asyncio
async def test_camera_disconnect_not_linked_to_person(client: AsyncClient):
    """Verify that camera_disconnected events are never linked to a person in scoped queries or timelines."""
    async with test_session() as session:
        # 1. Camera 1: Security (not in supervisor's camera scope)
        cam_sec = Camera(name="Security", rtsp_url="rtsp://localhost/sec", section="حراست", is_active=True)
        session.add(cam_sec)

        # 2. Camera 2: Packaging (in supervisor's camera scope)
        cam_pack = Camera(name="گارانتی یک", rtsp_url="rtsp://localhost/pack", section="بسته‌بندی", is_active=True)
        session.add(cam_pack)

        # 3. Person: Zahra Rahimi in Packaging
        person = Person(name="زهرا رحیمی", role="اپراتور", section="بسته‌بندی")
        session.add(person)
        await session.flush()

        # 4. Supervisor scoped to Packaging cam and Zahra Rahimi
        sup_role = Role(name="supervisor", display_name="سرپرست", permissions=["dashboard:view", "duty:view"])
        session.add(sup_role)
        await session.flush()

        sup_user = User(
            username="peyman",
            full_name="علی پیمان",
            password_hash="hash",
            salt="salt",
            role_id=sup_role.id,
            is_active=True,
            assigned_sections=["بسته‌بندی"],
            assigned_camera_ids=[cam_pack.id],
            assigned_person_ids=[person.id],
        )
        session.add(sup_user)

        # 5. Events:
        # Event A: Security camera disconnected (person_id is None or even legacy Zahra)
        ev_sec_disc = Event(
            camera_id=cam_sec.id,
            person_id=person.id,  # Simulate legacy bad data
            person_name="زهرا رحیمی",
            alert_type="camera_disconnected",
            confidence_score=0.0,
            snapshot_path="",
            is_known=False,
            timestamp=datetime.now(timezone.utc),
        )
        # Event B: Packaging camera disconnected
        ev_pack_disc = Event(
            camera_id=cam_pack.id,
            person_id=None,
            person_name=None,
            alert_type="camera_disconnected",
            confidence_score=0.0,
            snapshot_path="",
            is_known=False,
            timestamp=datetime.now(timezone.utc),
        )
        session.add_all([ev_sec_disc, ev_pack_disc])
        await session.commit()

        sup_id = sup_user.id
        p_id = person.id
        sec_cam_id = cam_sec.id
        pack_cam_id = cam_pack.id

    # Switch to supervisor user
    async def override_supervisor():
        async with test_session() as s:
            u = await s.get(User, sup_id)
            u.role = await s.get(Role, u.role_id)
            return u

    app.dependency_overrides[get_current_user] = override_supervisor

    try:
        # GET /api/events as supervisor
        resp = await client.get("/api/events")
        assert resp.status_code == 200
        data = resp.json()
        events = data.get("events", [])

        # Security camera disconnect must NOT appear in supervisor's feed
        sec_events = [e for e in events if e.get("camera_id") == sec_cam_id]
        assert len(sec_events) == 0, f"Security camera events leaked into supervisor view: {sec_events}"

        # Packaging camera disconnect SHOULD appear in supervisor's feed
        pack_events = [e for e in events if e.get("camera_id") == pack_cam_id]
        assert len(pack_events) == 1
        assert pack_events[0]["person_id"] is None
        assert pack_events[0]["person_name"] == "گارانتی یک"

    finally:
        async def override_admin():
            return mock_admin
        app.dependency_overrides[get_current_user] = override_admin

