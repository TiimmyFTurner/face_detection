"""
Tests for Lunch and Free-Time Break Presets Management & Person Shift Breaks.
"""

import pytest
from httpx import AsyncClient
from backend.models import BreakPreset, Camera, CameraZone, Person
from tests.test_api import test_session, client, setup_database


@pytest.mark.asyncio
async def test_break_presets_crud_api(client: AsyncClient):
    """Test full CRUD lifecycle of reusable break presets (lunch, rest, etc.)."""
    # 1. Create a lunch preset
    lunch_payload = {
        "name": "ناهار شرکت (Company Lunch)",
        "start_time": "12:00",
        "end_time": "13:00",
        "category": "lunch",
        "icon": "🍽️",
    }
    resp = await client.post("/api/break-presets", json=lunch_payload)
    assert resp.status_code == 201
    created = resp.json()
    assert created["name"] == "ناهار شرکت (Company Lunch)"
    assert created["start_time"] == "12:00"
    assert created["end_time"] == "13:00"
    preset_id = created["id"]

    # 2. Create a tea break preset (auto-icon resolution)
    tea_payload = {
        "name": "عصرانه و چای (Afternoon Tea)",
        "start_time": "16:30",
        "end_time": "17:00",
        "category": "rest",
    }
    resp2 = await client.post("/api/break-presets", json=tea_payload)
    assert resp2.status_code == 201
    created2 = resp2.json()
    assert created2["icon"] == "☕"
    tea_id = created2["id"]

    # 3. List presets
    list_resp = await client.get("/api/break-presets")
    assert list_resp.status_code == 200
    presets = list_resp.json()
    assert len(presets) >= 2
    assert any(p["id"] == preset_id for p in presets)
    assert any(p["id"] == tea_id for p in presets)

    # 4. Get preset by ID
    get_resp = await client.get(f"/api/break-presets/{preset_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "ناهار شرکت (Company Lunch)"

    # 5. Update preset
    update_resp = await client.put(f"/api/break-presets/{preset_id}", json={
        "name": "ناهار و استراحت تمدیدشده",
        "start_time": "12:15",
        "end_time": "13:15",
    })
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "ناهار و استراحت تمدیدشده"
    assert updated["start_time"] == "12:15"
    assert updated["end_time"] == "13:15"

    # 6. Delete presets
    del_resp = await client.delete(f"/api/break-presets/{preset_id}")
    assert del_resp.status_code == 204

    del_resp2 = await client.delete(f"/api/break-presets/{tea_id}")
    assert del_resp2.status_code == 204

    # 7. Confirm deletion
    get_del = await client.get(f"/api/break-presets/{preset_id}")
    assert get_del.status_code == 404


@pytest.mark.asyncio
async def test_person_shift_custom_free_times(client: AsyncClient):
    """Test saving and retrieving free_times on custom person shifts."""
    async with test_session() as session:
        p = Person(name="Break Worker Ali", role="Technician", section="تولید")
        session.add(p)
        await session.commit()
        await session.refresh(p)
        pid = p.id

    # Configure custom shift with free_times
    put_resp = await client.put(f"/api/persons/{pid}/shift", json={
        "custom_shift": {
            "shift_type": "fixed",
            "name": "شیفت سفارشی با وقت ناهار",
            "start_time": "08:00",
            "end_time": "17:00",
            "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"],
            "free_times": [
                {"name": "ناهار پرسنلی", "start_time": "12:00", "end_time": "13:00"},
                {"name": "چای عصر", "start_time": "16:00", "end_time": "16:20"},
            ],
        },
    })
    assert put_resp.status_code == 200
    data = put_resp.json()
    assert data["custom_shift"] is not None
    assert len(data["custom_shift"]["free_times"]) == 2
    assert data["custom_shift"]["free_times"][0]["name"] == "ناهار پرسنلی"

    # GET person shift
    get_resp = await client.get(f"/api/persons/{pid}/shift")
    assert get_resp.status_code == 200
    g_data = get_resp.json()
    assert g_data["custom_shift"]["free_times"][1]["name"] == "چای عصر"
    assert g_data["custom_shift"]["free_times"][1]["start_time"] == "16:00"
