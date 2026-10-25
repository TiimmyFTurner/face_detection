"""
Automated tests for Supervisor privacy enforcement (anti-picture, no-camera)
and person leave/off-duty management.
"""

import pytest
from httpx import AsyncClient
from backend.main import app
from backend.models import Camera, Person, User, Role, Event, CameraZone, ShiftTemplate
from backend.auth import create_access_token, get_current_user
from tests.test_api import test_session, client, setup_database


@pytest.mark.asyncio
async def test_person_leave_crud(client: AsyncClient):
    """Test creating, listing, and deleting leaves for a person."""
    async with test_session() as session:
        role = Role(
            name="admin",
            display_name="مدیر کل",
            permissions=["*"],
            is_system=True,
        )
        session.add(role)
        await session.flush()
        u = User(
            username="admin_user",
            full_name="مدیر سیستم",
            password_hash="testpasshash",
            salt="testsalt",
            role_id=role.id,
            is_active=True,
        )
        session.add(u)
        p = Person(name="Leave Tester", role="Tech", section="بسته‌بندی")
        session.add(p)
        await session.commit()
        await session.refresh(u)
        await session.refresh(p)
        uid = u.id
        pid = p.id

    token = create_access_token(uid, "admin_user")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. List leaves initially (empty)
    resp = await client.get(f"/api/persons/{pid}/leaves", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []

    # 2. Create a leave
    payload = {
        "start_date": "2026-10-25",
        "end_date": "2026-10-27",
        "leave_type": "daily_leave",
        "note": "مرخصی هماهنگ‌شده با سرپرست",
    }
    post_resp = await client.post(f"/api/persons/{pid}/leaves", json=payload, headers=headers)
    assert post_resp.status_code == 201
    leaves = post_resp.json()
    assert len(leaves) == 1
    assert leaves[0]["start_date"] == "2026-10-25"
    assert leaves[0]["leave_type"] == "daily_leave"
    leave_id = leaves[0]["id"]

    # 3. Verify get returns the created leave
    get_resp = await client.get(f"/api/persons/{pid}/leaves", headers=headers)
    assert get_resp.status_code == 200
    assert len(get_resp.json()) == 1

    # 4. Delete leave
    del_resp = await client.delete(f"/api/persons/{pid}/leaves/{leave_id}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json() == []

    # Confirm deletion
    get_after_del = await client.get(f"/api/persons/{pid}/leaves", headers=headers)
    assert get_after_del.status_code == 200
    assert get_after_del.json() == []


@pytest.mark.asyncio
async def test_supervisor_photo_and_camera_blocking(client: AsyncClient):
    """
    Test that a user with supervisor role:
    1. Is forbidden (403) from accessing snapshot images
    2. Is forbidden (403) from accessing camera streams, snapshots, and tests
    3. Has rtsp_url redacted in camera listings
    4. Has snapshot URLs and paths redacted in events listings
    5. Has avatar URLs redacted in duty roster
    """
    async with test_session() as session:
        # Create supervisor role
        sup_role = Role(
            name="supervisor",
            display_name="سرپرست کارخانه",
            permissions=["dashboard:view", "duty:view", "duty:manage", "zones:view", "persons:view", "persons:edit"],
            is_system=False,
        )
        session.add(sup_role)
        await session.flush()

        # Create supervisor user
        sup_user = User(
            username="test_supervisor_user",
            full_name="سرپرست آزمایشی",
            password_hash="testpasshash",
            salt="testsalt",
            role_id=sup_role.id,
            is_active=True,
            assigned_sections=["تولید"],
        )
        session.add(sup_user)

        # Create Camera and Person in the same section
        cam = Camera(name="Test Cam", rtsp_url="rtsp://admin:pass@192.168.1.50:554/live", section="تولید", is_active=True)
        session.add(cam)
        p = Person(name="Assigned Staff", role="Worker", section="تولید")
        session.add(p)
        await session.flush()

        # Create an event
        ev = Event(
            camera_id=cam.id,
            person_id=p.id,
            person_name=p.name,
            is_known=True,
            snapshot_path="snap_12345.jpg",
        )
        session.add(ev)
        await session.commit()
        await session.refresh(sup_user)
        await session.refresh(cam)
        await session.refresh(ev)

        sup_uid = sup_user.id
        cam_id = cam.id

    # Generate token for supervisor
    sup_token = create_access_token(sup_uid, "test_supervisor_user")
    headers = {"Authorization": f"Bearer {sup_token}"}

    orig_override = app.dependency_overrides.pop(get_current_user, None)
    try:
        # 1. Supervisor forbidden from viewing snapshots
        snap_resp = await client.get("/api/snapshots/snap_12345.jpg", headers=headers)
        assert snap_resp.status_code == 403

        # 2. Supervisor forbidden from camera snapshot
        cam_snap_resp = await client.get(f"/api/cameras/{cam_id}/snapshot", headers=headers)
        assert cam_snap_resp.status_code == 403

        # 3. Supervisor forbidden from camera stream
        stream_resp = await client.get(f"/api/cameras/{cam_id}/stream", headers=headers)
        assert stream_resp.status_code == 403

        # 4. Supervisor forbidden from camera RTSP test
        test_resp = await client.post(f"/api/cameras/{cam_id}/test", headers=headers)
        assert test_resp.status_code == 403

        # 5. Calling /api/cameras redacts rtsp_url to empty string
        cams_resp = await client.get("/api/cameras", headers=headers)
        assert cams_resp.status_code == 200
        cams = cams_resp.json()
        assert len(cams) >= 1
        found_cam = next((c for c in cams if c["id"] == cam_id), None)
        assert found_cam is not None
        assert found_cam["rtsp_url"] == ""

        # 6. Calling /api/events redacts snapshot_url and snapshot_path
        events_resp = await client.get("/api/events", headers=headers)
        assert events_resp.status_code == 200
        ev_data = events_resp.json()["events"]
        assert len(ev_data) >= 1
        for item in ev_data:
            assert item["snapshot_url"] == ""
            assert item["snapshot_path"] == ""

        # 7. Calling /api/zones/duty-roster redacts avatar_url
        roster_resp = await client.get("/api/zones/duty-roster", headers=headers)
        assert roster_resp.status_code == 200
        roster = roster_resp.json()["roster"]
        for r in roster:
            assert r["avatar_url"] is None
    finally:
        if orig_override:
            app.dependency_overrides[get_current_user] = orig_override


@pytest.mark.asyncio
async def test_supervisor_websocket_assigned_persons_notifications_only():
    """
    Test that real-time WebSocket notifications and zone alerts are strictly filtered:
    1. Supervisor ONLY receives notifications for assigned personnel.
    2. Notifications for unassigned personnel are silently dropped for supervisor.
    3. Even for assigned persons, snapshot URLs/paths are redacted to empty string in payload.
    4. Unscoped clients (admin) receive all notifications with original snapshot metadata.
    """
    import json
    from backend.stream_processor import ws_manager
    from backend.auth import UserScope

    class MockWebSocket:
        def __init__(self):
            self.sent_messages = []

        async def accept(self):
            pass

        async def send_text(self, text: str):
            self.sent_messages.append(text)

    # Scoped supervisor: only person 101 is assigned
    sup_scope = UserScope(is_scoped=True, sections=["تولید"], camera_ids={1}, person_ids={101})

    admin_ws = MockWebSocket()
    sup_ws = MockWebSocket()

    await ws_manager.connect(admin_ws, scope=None, is_supervisor=False)
    await ws_manager.connect(sup_ws, scope=sup_scope, is_supervisor=True)

    try:
        # 1. Message for assigned person 101
        msg_assigned = {
            "type": "zone_alert",
            "alert_type": "absence_timeout",
            "message": "Assigned person absent",
            "event": {
                "id": 1,
                "person_id": 101,
                "camera_id": 1,
                "snapshot_url": "/api/snapshots/test.jpg",
                "snapshot_path": "test.jpg",
            },
        }
        await ws_manager.broadcast(msg_assigned)

        # 2. Message for unassigned person 202
        msg_unassigned = {
            "type": "zone_alert",
            "alert_type": "absence_timeout",
            "message": "Unassigned person absent",
            "event": {
                "id": 2,
                "person_id": 202,
                "camera_id": 2,
                "snapshot_url": "/api/snapshots/secret.jpg",
                "snapshot_path": "secret.jpg",
            },
        }
        await ws_manager.broadcast(msg_unassigned)

        # Supervisor must ONLY have received message 1 (for person 101)
        assert len(sup_ws.sent_messages) == 1
        sup_data = json.loads(sup_ws.sent_messages[0])
        assert sup_data["event"]["person_id"] == 101
        # Snapshot privacy redaction for supervisor
        assert sup_data["event"]["snapshot_url"] == ""
        assert sup_data["event"]["snapshot_path"] == ""

        # Admin must have received both messages
        assert len(admin_ws.sent_messages) == 2
        admin_data1 = json.loads(admin_ws.sent_messages[0])
        admin_data2 = json.loads(admin_ws.sent_messages[1])
        assert admin_data1["event"]["person_id"] == 101
        assert admin_data1["event"]["snapshot_path"] == "test.jpg"
        assert admin_data2["event"]["person_id"] == 202
        assert admin_data2["event"]["snapshot_path"] == "secret.jpg"
    finally:
        ws_manager.disconnect(admin_ws)
        ws_manager.disconnect(sup_ws)


@pytest.mark.asyncio
async def test_supervisor_person_analytics_access_and_export(client: AsyncClient):
    """
    Test supervisor viewing assigned person analytics and exporting reports:
    1. Assigned person analytics returns 200 with zero photos (ref_photos=[], last_seen_snapshot_url=None)
    2. Date range filtering (days, start_date, end_date) works properly
    3. Unassigned person analytics returns 403 Forbidden
    4. Export to Excel (.xlsx) returns 200 with proper media-type and non-empty payload
    5. Export to CSV returns 200 with UTF-8 BOM encoding
    6. Export for unassigned person returns 403 Forbidden
    """
    saved_override = app.dependency_overrides.pop(get_current_user, None)

    try:
        async with test_session() as session:
            sup_role = Role(
                name="supervisor",
                display_name="سرپرست کارخانه",
                permissions=["dashboard:view", "duty:view", "zones:view", "persons:view"],
                is_system=False,
            )
            session.add(sup_role)
            await session.flush()

            p_assigned = Person(name="Worker Assigned", role="Operator", section="بخش مجاز")
            p_unassigned = Person(name="Worker Secret", role="Manager", section="بخش محرمانه")
            session.add_all([p_assigned, p_unassigned])
            await session.flush()

            sup_user = User(
                username="supervisor_analytics_tester",
                full_name="سرپرست تست آمار",
                password_hash="hash",
                salt="salt",
                role_id=sup_role.id,
                is_active=True,
                assigned_sections=["بخش مجاز"],
                assigned_person_ids=[p_assigned.id],
            )
            session.add(sup_user)
            await session.commit()
            await session.refresh(sup_user)
            await session.refresh(p_assigned)
            await session.refresh(p_unassigned)

            s_uid = sup_user.id
            pid_assigned = p_assigned.id
            pid_unassigned = p_unassigned.id

        token = create_access_token(s_uid, "supervisor_analytics_tester")
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Assigned person analytics with days=7
        resp_7d = await client.get(f"/api/persons/{pid_assigned}/analytics?days=7", headers=headers)
        assert resp_7d.status_code == 200
        data_7d = resp_7d.json()
        assert data_7d["person_id"] == pid_assigned
        assert data_7d["name"] == "Worker Assigned"
        # Zero-photo privacy check
        assert data_7d["reference_photos"] == []
        assert data_7d["summary"]["last_seen_snapshot_url"] is None
        # Check 7 days activity
        assert len(data_7d["daily_activity_last_14_days"]) == 7

        # 2. Assigned person analytics with custom start_date and end_date
        resp_custom = await client.get(
            f"/api/persons/{pid_assigned}/analytics?start_date=2026-10-20&end_date=2026-10-24",
            headers=headers,
        )
        assert resp_custom.status_code == 200
        data_custom = resp_custom.json()
        # 2026-10-20 to 2026-10-24 inclusive is 5 days
        assert len(data_custom["daily_activity_last_14_days"]) == 5

        # 3. Unassigned person analytics should be 403 Forbidden
        resp_forbidden = await client.get(f"/api/persons/{pid_unassigned}/analytics", headers=headers)
        assert resp_forbidden.status_code == 403

        # 4. Export assigned person analytics to Excel (.xlsx)
        resp_export_xlsx = await client.get(
            f"/api/persons/{pid_assigned}/analytics/export?format=xlsx&days=7",
            headers=headers,
        )
        assert resp_export_xlsx.status_code == 200
        assert resp_export_xlsx.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert f"analytics_{pid_assigned}" in resp_export_xlsx.headers["content-disposition"]
        assert len(resp_export_xlsx.content) > 1000  # Valid Excel binary file

        # 5. Export assigned person analytics to CSV
        resp_export_csv = await client.get(
            f"/api/persons/{pid_assigned}/analytics/export?format=csv&days=7",
            headers=headers,
        )
        assert resp_export_csv.status_code == 200
        assert "text/csv" in resp_export_csv.headers["content-type"]
        assert resp_export_csv.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM
        csv_str = resp_export_csv.content.decode("utf-8")
        assert "Worker Assigned" in csv_str
        assert "خلاصه شاخص‌های کلیدی عملکرد" in csv_str

        # 6. Export unassigned person analytics should be 403 Forbidden
        resp_export_forbidden = await client.get(
            f"/api/persons/{pid_unassigned}/analytics/export?format=xlsx",
            headers=headers,
        )
        assert resp_export_forbidden.status_code == 403
    finally:
        if saved_override is not None:
            app.dependency_overrides[get_current_user] = saved_override

