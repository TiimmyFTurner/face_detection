"""
Automated tests for Shift Substitution (جانشین شیفت) management,
conflict checking, supervisor privacy scoping, and duty roster integration.
"""

from datetime import datetime, timezone
import pytest
from httpx import AsyncClient

from backend.auth import create_access_token
from backend.models import Camera, CameraZone, Person, Role, ShiftSubstitution, User
from tests.test_api import client, setup_database, test_session


@pytest.mark.asyncio
async def test_create_and_list_substitution(client: AsyncClient):
    """Test creating, listing, and deleting a shift substitution."""
    async with test_session() as session:
        role = Role(name="admin", display_name="مدیر کل", permissions=["*"], is_system=True)
        session.add(role)
        await session.flush()
        u = User(username="admin_subst", full_name="مدیر سیستم", password_hash="pass", salt="salt", role_id=role.id)
        session.add(u)

        p1 = Person(name="Original Staff", role="Operator", section="Packaging")
        p2 = Person(name="Substitute Staff", role="Relief", section="Packaging")
        session.add_all([p1, p2])
        await session.flush()

        cam = Camera(name="Pack Cam", rtsp_url="rtsp://127.0.0.1/1", section="Packaging")
        session.add(cam)
        await session.flush()

        zone = CameraZone(camera_id=cam.id, name="Station 1", x=10, y=10, width=50, height=50, assigned_person_ids=[p1.id])
        session.add(zone)

        await session.commit()
        uid = u.id
        p1_id = p1.id
        p2_id = p2.id
        zone_id = zone.id

    token = create_access_token(uid, "admin_subst")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Create a shift substitution
    payload = {
        "original_person_id": p1_id,
        "substitute_person_id": p2_id,
        "start_date": "2026-11-05",
        "end_date": "2026-11-06",
        "zone_id": zone_id,
        "note": "پوشش شیفت بابت مرخصی",
    }
    resp = await client.post("/api/substitutions", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["original_person_id"] == p1_id
    assert data["original_person_name"] == "Original Staff"
    assert data["substitute_person_id"] == p2_id
    assert data["substitute_person_name"] == "Substitute Staff"
    assert data["zone_id"] == zone_id
    assert data["zone_name"] == "Station 1"
    subst_id = data["id"]

    # 2. List substitutions
    list_resp = await client.get("/api/substitutions", headers=headers)
    assert list_resp.status_code == 200
    all_subs = list_resp.json()
    assert any(s["id"] == subst_id for s in all_subs)

    # 3. Filter by person_id
    p1_filter_resp = await client.get(f"/api/substitutions?person_id={p1_id}", headers=headers)
    assert p1_filter_resp.status_code == 200
    assert len(p1_filter_resp.json()) >= 1

    # 4. Delete / cancel substitution
    del_resp = await client.delete(f"/api/substitutions/{subst_id}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["id"] == subst_id

    # Verify deleted
    verify_resp = await client.get("/api/substitutions", headers=headers)
    assert not any(s["id"] == subst_id for s in verify_resp.json())


@pytest.mark.asyncio
async def test_self_substitution_and_invalid_dates_rejected(client: AsyncClient):
    """Self substitution and inverted date ranges must be rejected with 400."""
    async with test_session() as session:
        role = Role(name="admin", display_name="Admin", permissions=["*"], is_system=True)
        session.add(role)
        await session.flush()
        u = User(username="admin_sub_val", full_name="Admin", password_hash="pass", salt="salt", role_id=role.id)
        session.add(u)
        p = Person(name="Solo Person", role="Tech", section="Packaging")
        session.add(p)
        await session.commit()
        uid = u.id
        pid = p.id

    token = create_access_token(uid, "admin_sub_val")
    headers = {"Authorization": f"Bearer {token}"}

    # Self substitution
    resp_self = await client.post("/api/substitutions", json={
        "original_person_id": pid,
        "substitute_person_id": pid,
        "start_date": "2026-11-10",
        "end_date": "2026-11-10",
    }, headers=headers)
    assert resp_self.status_code == 400

    # Inverted date
    p2 = None
    async with test_session() as session:
        p2_obj = Person(name="Second Person", role="Tech", section="Packaging")
        session.add(p2_obj)
        await session.commit()
        await session.refresh(p2_obj)
        p2_id = p2_obj.id

    resp_dates = await client.post("/api/substitutions", json={
        "original_person_id": pid,
        "substitute_person_id": p2_id,
        "start_date": "2026-11-15",
        "end_date": "2026-11-10",
    }, headers=headers)
    assert resp_dates.status_code == 400


@pytest.mark.asyncio
async def test_conflict_detection(client: AsyncClient):
    """Test checking schedule conflicts for substitute colleague."""
    async with test_session() as session:
        role = Role(name="admin", display_name="Admin", permissions=["*"], is_system=True)
        session.add(role)
        await session.flush()
        u = User(username="admin_conflict", full_name="Admin", password_hash="pass", salt="salt", role_id=role.id)
        session.add(u)

        p1 = Person(name="Person A", section="Assembly")
        # Substitute with an active leave on 2026-11-12
        p2 = Person(name="Person B (On Leave)", section="Assembly", leaves=[{
            "id": "lev1",
            "start_date": "2026-11-10",
            "end_date": "2026-11-15",
            "leave_type": "daily_leave",
            "note": "Vacation",
        }])
        session.add_all([p1, p2])
        await session.commit()
        uid = u.id
        p1_id = p1.id
        p2_id = p2.id

    token = create_access_token(uid, "admin_conflict")
    headers = {"Authorization": f"Bearer {token}"}

    # Check conflict endpoint
    resp = await client.post("/api/substitutions/check-conflict", json={
        "original_person_id": p1_id,
        "substitute_person_id": p2_id,
        "start_date": "2026-11-12",
        "end_date": "2026-11-12",
    }, headers=headers)
    assert resp.status_code == 200
    info = resp.json()
    assert info["has_conflict"] is True
    assert info["conflict_type"] == "leave"
    assert "مرخصی" in info["detail"]


@pytest.mark.asyncio
async def test_supervisor_scoping_on_substitutions(client: AsyncClient):
    """Scoped supervisor must only be allowed to substitute persons within assigned section."""
    async with test_session() as session:
        sup_role = Role(name="supervisor", display_name="سرپرست", permissions=["duty:view", "duty:manage", "persons:view", "persons:edit"], is_system=True)
        session.add(sup_role)
        await session.flush()

        sup = User(
            username="scoped_supervisor_sub",
            full_name="سرپرست بسته‌بندی",
            password_hash="pass",
            salt="salt",
            role_id=sup_role.id,
            assigned_sections=["بسته‌بندی"],
        )
        session.add(sup)

        # Allowed persons (in بسته‌بندی)
        p_in1 = Person(name="مجاز ۱", section="بسته‌بندی")
        p_in2 = Person(name="مجاز ۲", section="بسته‌بندی")

        # Forbidden person (in مونتاژ)
        p_out = Person(name="غیرمجاز", section="مونتاژ")

        session.add_all([p_in1, p_in2, p_out])
        await session.commit()
        sup_id = sup.id
        in1_id = p_in1.id
        in2_id = p_in2.id
        out_id = p_out.id

    token = create_access_token(sup_id, "scoped_supervisor_sub")
    headers = {"Authorization": f"Bearer {token}"}

    from backend.main import app
    from backend.auth import get_current_user
    orig_override = app.dependency_overrides.pop(get_current_user, None)
    try:
        # 1. Scoped supervisor CAN substitute between in1 and in2
        resp_ok = await client.post("/api/substitutions", json={
            "original_person_id": in1_id,
            "substitute_person_id": in2_id,
            "start_date": "2026-11-20",
            "end_date": "2026-11-20",
        }, headers=headers)
        assert resp_ok.status_code == 201

        # 2. Scoped supervisor CANNOT assign substitute to unassigned person (returns 403)
        resp_forbidden = await client.post("/api/substitutions", json={
            "original_person_id": out_id,
            "substitute_person_id": in2_id,
            "start_date": "2026-11-20",
            "end_date": "2026-11-20",
        }, headers=headers)
        assert resp_forbidden.status_code == 403
    finally:
        if orig_override is not None:
            app.dependency_overrides[get_current_user] = orig_override


@pytest.mark.asyncio
async def test_leave_creation_with_coupled_substitute(client: AsyncClient):
    """Creating a leave with substitute_person_id creates linked ShiftSubstitution, and deleting leave deletes substitution."""
    async with test_session() as session:
        role = Role(name="admin", display_name="Admin", permissions=["*"], is_system=True)
        session.add(role)
        await session.flush()
        u = User(username="admin_coupled_leave", full_name="Admin", password_hash="pass", salt="salt", role_id=role.id)
        session.add(u)

        p_orig = Person(name="Worker On Leave", section="Warehouse")
        p_sub = Person(name="Colleague Covering", section="Warehouse")
        session.add_all([p_orig, p_sub])
        await session.commit()
        uid = u.id
        orig_id = p_orig.id
        sub_id = p_sub.id

    token = create_access_token(uid, "admin_coupled_leave")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Create leave with substitute
    leave_payload = {
        "start_date": "2026-11-25",
        "end_date": "2026-11-26",
        "leave_type": "daily_leave",
        "note": "پوشش هماهنگ‌شده",
        "substitute_person_id": sub_id,
    }
    resp = await client.post(f"/api/persons/{orig_id}/leaves", json=leave_payload, headers=headers)
    assert resp.status_code == 201, resp.text
    leaves = resp.json()
    assert len(leaves) >= 1
    created_leave = leaves[-1]
    assert created_leave["substitute_person_id"] == sub_id
    assert created_leave["substitute_person_name"] == "Colleague Covering"
    leave_id = created_leave["id"]

    # 2. Check that linked ShiftSubstitution was created in DB
    subs_resp = await client.get(f"/api/substitutions?person_id={orig_id}", headers=headers)
    assert subs_resp.status_code == 200
    subs = subs_resp.json()
    linked_sub = next((s for s in subs if s.get("leave_id") == leave_id), None)
    assert linked_sub is not None
    assert linked_sub["substitute_person_id"] == sub_id

    # 3. Delete leave -> should cascade delete linked substitution
    del_leave_resp = await client.delete(f"/api/persons/{orig_id}/leaves/{leave_id}", headers=headers)
    assert del_leave_resp.status_code == 200

    subs_after_resp = await client.get(f"/api/substitutions?person_id={orig_id}", headers=headers)
    assert not any(s.get("leave_id") == leave_id for s in subs_after_resp.json())


@pytest.mark.asyncio
async def test_duty_roster_substitution_badges(client: AsyncClient):
    """Verify GET /api/zones/duty-roster returns is_substituted and is_substituting_for badges."""
    today_str = datetime.now().strftime("%Y-%m-%d")

    async with test_session() as session:
        role = Role(name="admin", display_name="Admin", permissions=["*"], is_system=True)
        session.add(role)
        await session.flush()
        u = User(username="admin_roster_sub", full_name="Admin", password_hash="pass", salt="salt", role_id=role.id)
        session.add(u)

        p1 = Person(name="Roster Orig", section="Line 1")
        p2 = Person(name="Roster Sub", section="Line 1")
        session.add_all([p1, p2])
        await session.flush()

        cam = Camera(name="Roster Cam", rtsp_url="rtsp://127.0.0.1/roster", section="Line 1")
        session.add(cam)
        await session.flush()

        # Zone assigned to p1
        z = CameraZone(camera_id=cam.id, name="Line 1 Desk", x=0, y=0, width=100, height=100, assigned_person_ids=[p1.id])
        session.add(z)
        await session.flush()

        # Active substitution for today
        subst = ShiftSubstitution(
            original_person_id=p1.id,
            substitute_person_id=p2.id,
            start_date=today_str,
            end_date=today_str,
            zone_id=z.id,
            note="Testing roster substitution",
        )
        session.add(subst)
        await session.commit()
        uid = u.id
        p1_id = p1.id
        p2_id = p2.id

    token = create_access_token(uid, "admin_roster_sub")
    headers = {"Authorization": f"Bearer {token}"}

    roster_resp = await client.get("/api/zones/duty-roster?only_active=false", headers=headers)
    assert roster_resp.status_code == 200, roster_resp.text
    roster_data = roster_resp.json()
    roster = roster_data.get("roster", [])

    p1_entry = next((r for r in roster if r["person_id"] == p1_id), None)
    assert p1_entry is not None
    assert p1_entry["is_substituted"] is True
    assert p1_entry["substitute_id"] == p2_id
    assert p1_entry["substitute_name"] == "Roster Sub"
