"""
Tests for Factory Sections, Supervisor Scoped Permissions, and Person Shift Management.
"""

import pytest
from httpx import AsyncClient
from backend.models import Camera, Person, Section, User, Role, Event, CameraZone, ShiftTemplate
from tests.test_api import test_session, client, setup_database


@pytest.mark.asyncio
async def test_section_crud(client: AsyncClient):
    """Test listing, creating, updating, and deleting factory sections."""
    # Create new section
    new_sec_payload = {
        "name": "بخش تست آزمایشگاهی",
        "description": "تست اتوماسیون کنترل کیفیت",
    }
    create_resp = await client.post("/api/sections", json=new_sec_payload)
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["name"] == "بخش تست آزمایشگاهی"
    sec_id = created["id"]

    # List sections
    resp = await client.get("/api/sections")
    assert resp.status_code == 200
    sections = resp.json()
    assert any(s["name"] == "بخش تست آزمایشگاهی" for s in sections)

    # Update section
    update_resp = await client.put(f"/api/sections/{sec_id}", json={
        "name": "بخش تست آزمایشگاهی پیشرفته",
        "description": "توضیحات ویرایش‌شده",
    })
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "بخش تست آزمایشگاهی پیشرفته"

    # Delete section
    del_resp = await client.delete(f"/api/sections/{sec_id}")
    assert del_resp.status_code == 204

    # Confirm deleted
    get_resp = await client.get(f"/api/sections/{sec_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_person_shift_management(client: AsyncClient):
    """Test GET and PUT /api/persons/{person_id}/shift endpoints."""
    async with test_session() as session:
        # Create person and camera with zone
        p = Person(name="Shift Worker Reza", role="Operator", section="بسته‌بندی")
        session.add(p)
        cam = Camera(name="Packing Cam 1", rtsp_url="rtsp://localhost/pack1", section="بسته‌بندی")
        session.add(cam)
        await session.flush()

        zone = CameraZone(
            camera_id=cam.id,
            name="Packaging Line A",
            x=10,
            y=10,
            width=200,
            height=200,
            assigned_person_ids=[],
            alert_mode="presence",
            start_time="08:00",
            end_time="17:00",
            is_active=True,
        )
        session.add(zone)

        # Create shift template
        tmpl = ShiftTemplate(
            name="Morning Shift",
            start_time="07:00",
            end_time="15:30",
            active_days=["Sat", "Sun", "Mon", "Tue", "Wed"],
            grace_period_minutes=15,
            absence_timeout_minutes=3,
        )
        session.add(tmpl)
        await session.commit()
        await session.refresh(p)
        await session.refresh(zone)
        await session.refresh(tmpl)
        pid = p.id
        zid = zone.id
        tid = tmpl.id

    # 1. Get shift config
    get_resp = await client.get(f"/api/persons/{pid}/shift")
    assert get_resp.status_code == 200
    shift_data = get_resp.json()
    assert shift_data["person_id"] == pid
    assert shift_data["section"] == "بسته‌بندی"

    # 2. Update shift with template and zone assignment
    update_payload = {
        "section": "بسته‌بندی",
        "shift_template_id": tid,
        "assigned_zone_ids": [zid],
    }
    put_resp = await client.put(f"/api/persons/{pid}/shift", json=update_payload)
    assert put_resp.status_code == 200
    res_data = put_resp.json()
    assert res_data["shift_template_id"] == tid
    assert len(res_data["assigned_zones"]) == 1
    assert res_data["assigned_zones"][0]["id"] == zid

    # Verify zone now contains person
    async with test_session() as session:
        updated_zone = await session.get(CameraZone, zid)
        assert pid in (updated_zone.assigned_person_ids or [])

    # 3. Update shift with custom shift hours and unassign zone
    custom_payload = {
        "section": "بسته‌بندی",
        "shift_template_id": None,
        "custom_shift": {
            "start_time": "09:00",
            "end_time": "18:00",
            "active_days": ["Sat", "Sun", "Mon"],
            "grace_period_minutes": 10,
            "absence_timeout_minutes": 5,
        },
        "assigned_zone_ids": [],
    }
    put_resp2 = await client.put(f"/api/persons/{pid}/shift", json=custom_payload)
    assert put_resp2.status_code == 200
    res_data2 = put_resp2.json()
    assert res_data2["shift_template_id"] is None
    assert res_data2["custom_shift"]["start_time"] == "09:00"
    assert len(res_data2["assigned_zones"]) == 0

    # Verify zone unassigned
    async with test_session() as session:
        updated_zone = await session.get(CameraZone, zid)
        assert pid not in (updated_zone.assigned_person_ids or [])


@pytest.mark.asyncio
async def test_supervisor_scope_isolation(client: AsyncClient):
    """
    Test that a supervisor scoped to 'بسته‌بندی' section only sees
    cameras, persons, and events belonging to their section.
    """
    async with test_session() as session:
        # Create Resources in Packaging section
        cam_pack = Camera(name="Cam Pack Area", rtsp_url="rtsp://localhost/p", section="بسته‌بندی", is_active=True)
        session.add(cam_pack)
        p_pack = Person(name="Worker Pack", role="Packer", section="بسته‌بندی")
        session.add(p_pack)

        # Create Resources in Assembly section
        cam_asmb = Camera(name="Cam Assembly Area", rtsp_url="rtsp://localhost/a", section="خط تولید", is_active=True)
        session.add(cam_asmb)
        p_asmb = Person(name="Worker Assembly", role="Assembler", section="خط تولید")
        session.add(p_asmb)

        await session.flush()

        # Events
        ev_pack = Event(camera_id=cam_pack.id, person_id=p_pack.id, is_known=True, snapshot_path="pack.jpg")
        session.add(ev_pack)
        ev_asmb = Event(camera_id=cam_asmb.id, person_id=p_asmb.id, is_known=True, snapshot_path="asmb.jpg")
        session.add(ev_asmb)

        # Create Supervisor User scoped to 'بسته‌بندی'
        # Get or create supervisor role
        sup_role = Role(name="supervisor_test", display_name="سرپرست", permissions=[
            "cameras:view", "persons:view", "events:view", "dashboard:view", "sections:view"
        ])
        session.add(sup_role)
        await session.flush()

        sup_user = User(
            username="sup_packer",
            full_name="سرپرست بسته‌بندی",
            password_hash="hash",
            salt="testsalt",
            role_id=sup_role.id,
            is_active=True,
            assigned_sections=["بسته‌بندی"],
            assigned_camera_ids=[],
            assigned_person_ids=[],
        )
        session.add(sup_user)
        await session.commit()
        await session.refresh(sup_user)
        sup_id = sup_user.id
        pack_cam_id = cam_pack.id
        asmb_cam_id = cam_asmb.id
        pack_per_id = p_pack.id
        asmb_per_id = p_asmb.id

    # Test scope resolution directly
    from backend.auth import get_user_scope
    async with test_session() as session:
        user = await session.get(User, sup_id)
        scope = await get_user_scope(user, session)
        assert scope.is_scoped is True
        assert pack_cam_id in scope.camera_ids
        assert asmb_cam_id not in scope.camera_ids
        assert pack_per_id in scope.person_ids
        assert asmb_per_id not in scope.person_ids

        # Access check methods
        assert scope.can_access_camera(pack_cam_id) is True
        assert scope.can_access_camera(asmb_cam_id) is False
        assert scope.can_access_person(pack_per_id) is True
        assert scope.can_access_person(asmb_per_id) is False


@pytest.mark.asyncio
async def test_supervisor_camera_workstation_isolation(client: AsyncClient):
    """Test that supervisors can only view and select workstations on cameras assigned to them."""
    from backend.main import app
    from backend.auth import get_current_user
    from tests.test_api import mock_admin

    async with test_session() as session:
        # Create Camera 1 (Packaging - assigned to supervisor)
        cam1 = Camera(name="Pack Cam #1", rtsp_url="rtsp://localhost/p1", section="بسته‌بندی", is_active=True)
        session.add(cam1)

        # Create Camera 2 (Security - NOT assigned to supervisor)
        cam2 = Camera(name="Security Cam #2", rtsp_url="rtsp://localhost/sec", section="حراست", is_active=True)
        session.add(cam2)

        # Create Person in Packaging
        person = Person(name="Worker Packaging", role="Packer", section="بسته‌بندی")
        session.add(person)
        await session.flush()

        # Zone on Camera 1 (Packaging)
        z1 = CameraZone(
            camera_id=cam1.id,
            name="Zone Pack 1",
            x=10, y=10, width=50, height=50,
            assigned_person_ids=[],
            alert_mode="presence",
        )
        session.add(z1)

        # Zone on Camera 2 (Security)
        z2 = CameraZone(
            camera_id=cam2.id,
            name="Zone Security 2",
            x=10, y=10, width=50, height=50,
            assigned_person_ids=[],
            alert_mode="presence",
        )
        session.add(z2)

        # Supervisor User scoped to 'بسته‌بندی' and cam1
        sup_role = Role(
            name="supervisor",
            display_name="سرپرست بسته‌بندی",
            permissions=[
                "dashboard:view", "duty:view", "duty:manage",
                "cameras:view", "persons:view", "persons:edit",
                "zones:view",
            ],
        )
        session.add(sup_role)
        await session.flush()

        sup_user = User(
            username="sup_packaging_user",
            full_name="سرپرست بسته‌بندی",
            password_hash="hash",
            salt="salt",
            role_id=sup_role.id,
            is_active=True,
            assigned_sections=["بسته‌بندی"],
            assigned_camera_ids=[cam1.id],
            assigned_person_ids=[person.id],
        )
        session.add(sup_user)
        await session.commit()
        await session.refresh(sup_user)

        c1_id = cam1.id
        c2_id = cam2.id
        z1_id = z1.id
        z2_id = z2.id
        p_id = person.id
        sup_id = sup_user.id

    # Switch current user to supervisor
    async def override_supervisor():
        async with test_session() as s:
            u = await s.get(User, sup_id)
            u.role = await s.get(Role, u.role_id)
            return u

    app.dependency_overrides[get_current_user] = override_supervisor

    try:
        # 1. GET /api/cameras for supervisor should ONLY return Camera 1
        cam_resp = await client.get("/api/cameras")
        assert cam_resp.status_code == 200
        cams = cam_resp.json()
        cam_ids = [c["id"] for c in cams]
        assert c1_id in cam_ids
        assert c2_id not in cam_ids

        # 2. GET /api/zones for supervisor should ONLY return Zone 1 (Camera 1)
        zone_resp = await client.get("/api/zones")
        assert zone_resp.status_code == 200
        zones = zone_resp.json()
        zone_ids = [z["id"] for z in zones]
        assert z1_id in zone_ids
        assert z2_id not in zone_ids

        # 3. GET /api/cameras/{cam2_id}/zones should be 403 Forbidden
        cam2_zones_resp = await client.get(f"/api/cameras/{c2_id}/zones")
        assert cam2_zones_resp.status_code == 403

        # 4. GET /api/cameras/{cam1_id}/zones should succeed
        cam1_zones_resp = await client.get(f"/api/cameras/{c1_id}/zones")
        assert cam1_zones_resp.status_code == 200
        assert any(z["id"] == z1_id for z in cam1_zones_resp.json())

        # 5. Supervisor trying to assign unauthorized zone (Zone 2 on Camera 2) must fail with 403
        bad_put_resp = await client.put(f"/api/persons/{p_id}/shift", json={
            "section": "بسته‌بندی",
            "assigned_zone_ids": [z2_id],
        })
        assert bad_put_resp.status_code == 403

        # 6. Supervisor assigning authorized zone (Zone 1 on Camera 1) succeeds
        ok_put_resp = await client.put(f"/api/persons/{p_id}/shift", json={
            "section": "بسته‌بندی",
            "assigned_zone_ids": [z1_id],
        })
        assert ok_put_resp.status_code == 200
        assigned = [z["id"] for z in ok_put_resp.json()["assigned_zones"]]
        assert z1_id in assigned

    finally:
        # Restore mock admin override
        async def override_admin():
            return mock_admin
        app.dependency_overrides[get_current_user] = override_admin
