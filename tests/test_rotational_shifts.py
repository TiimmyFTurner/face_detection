"""
Tests for Rotational Shifts (نوبت‌کاری چرخشی / گردشی)
e.g. 2 Days, 2 Nights, 1 Off / 2 Days, 2 Nights, 2 Off.
"""

from datetime import datetime, date, timedelta
import pytest
from httpx import AsyncClient

from backend.shift_utils import get_rotation_day_state
from backend.models import Person, Camera, CameraZone, ShiftTemplate
from tests.test_api import test_session, client, setup_database


def test_rotation_math_and_overnight_carryover():
    """Verify cycle index arithmetic, day/night shift windows, and overnight carryover."""
    pattern = {
        "pattern_type": "2d_2n_1off",
        "cycle": ["day", "day", "night", "night", "off"],
        "anchor_date": "2026-01-01",
        "day_start": "07:00",
        "day_end": "19:00",
        "night_start": "19:00",
        "night_end": "07:00",
    }

    # Day 0: 2026-01-01 at 10:00 AM -> Day Shift (Active)
    dt_day0 = datetime(2026, 1, 1, 10, 0)
    res0 = get_rotation_day_state(pattern, dt_day0)
    assert res0["shift_kind"] == "day"
    assert res0["cycle_day_number"] == 1
    assert res0["is_active_now"] is True

    # Day 0 at 21:00 PM -> Outside day shift
    res0_evening = get_rotation_day_state(pattern, datetime(2026, 1, 1, 21, 0))
    assert res0_evening["shift_kind"] == "day"
    assert res0_evening["is_active_now"] is False

    # Day 1: 2026-01-02 -> Second Day Shift
    res1 = get_rotation_day_state(pattern, datetime(2026, 1, 2, 12, 0))
    assert res1["shift_kind"] == "day"
    assert res1["cycle_day_number"] == 2
    assert res1["is_active_now"] is True

    # Day 2: 2026-01-03 at 22:00 -> Night Shift 1 (Active)
    res2 = get_rotation_day_state(pattern, datetime(2026, 1, 3, 22, 0))
    assert res2["shift_kind"] == "night"
    assert res2["cycle_day_number"] == 3
    assert res2["is_active_now"] is True
    assert res2["is_overnight"] is True

    # Day 3 morning: 2026-01-04 at 04:30 AM -> Carryover from Day 2 Night Shift!
    res3_early = get_rotation_day_state(pattern, datetime(2026, 1, 4, 4, 30))
    assert res3_early["shift_kind"] == "night"
    assert res3_early["is_active_now"] is True
    assert "دیشب" in res3_early["shift_name"]

    # Day 4: 2026-01-05 at 14:00 -> OFF Day (استراحت / آف)
    res4 = get_rotation_day_state(pattern, datetime(2026, 1, 5, 14, 0))
    assert res4["shift_kind"] == "off"
    assert res4["cycle_day_number"] == 5
    assert res4["is_active_now"] is False
    assert "استراحت" in res4["shift_name"]

    # Day 5: 2026-01-06 -> Full cycle repeat, back to Day Shift 1
    res5 = get_rotation_day_state(pattern, datetime(2026, 1, 6, 9, 0))
    assert res5["shift_kind"] == "day"
    assert res5["cycle_day_number"] == 1
    assert res5["is_active_now"] is True


@pytest.mark.asyncio
async def test_shift_template_rotational_api(client: AsyncClient):
    """Test creating and retrieving a Rotational Shift Template via API."""
    payload = {
        "name": "شیفت چرخشی تست ۲ روز ۲ شب ۱ آف",
        "start_time": "07:00",
        "end_time": "19:00",
        "color": "#f43f5e",
        "shift_type": "rotational",
        "rotation_pattern": {
            "pattern_type": "2d_2n_1off",
            "cycle": ["day", "day", "night", "night", "off"],
            "anchor_date": "2026-01-01",
            "day_start": "07:00",
            "day_end": "19:00",
            "night_start": "19:00",
            "night_end": "07:00",
        },
        "grace_period_minutes": 15,
        "absence_timeout_minutes": 5,
    }

    create_resp = await client.post("/api/shift-templates", json=payload)
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["shift_type"] == "rotational"
    assert created["rotation_pattern"]["pattern_type"] == "2d_2n_1off"
    tmpl_id = created["id"]

    # Get by ID
    get_resp = await client.get(f"/api/shift-templates/{tmpl_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["rotation_pattern"]["cycle"] == ["day", "day", "night", "night", "off"]


@pytest.mark.asyncio
async def test_person_rotational_shift_assignment(client: AsyncClient):
    """Test assigning custom rotational shift (2D-2N-1OFF) to a person."""
    async with test_session() as session:
        p = Person(name="Rotational Worker Mehdi", role="Security Guard", section="حراست")
        session.add(p)
        await session.commit()
        await session.refresh(p)
        pid = p.id

    payload = {
        "section": "حراست",
        "custom_shift": {
            "shift_type": "rotational",
            "name": "نوبت‌کاری چرخشی سفارشی (۲ روز، ۲ شب، ۱ آف)",
            "start_time": "07:00",
            "end_time": "07:00",
            "rotation_pattern": {
                "pattern_type": "2d_2n_1off",
                "cycle": ["day", "day", "night", "night", "off"],
                "anchor_date": "2026-01-01",
                "day_start": "07:00",
                "day_end": "19:00",
                "night_start": "19:00",
                "night_end": "07:00",
                "grace_period_minutes": 15,
                "absence_timeout_minutes": 5,
            },
        },
    }

    resp = await client.put(f"/api/persons/{pid}/shift", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["custom_shift"]["shift_type"] == "rotational"
    assert data["effective_shift"]["rotation_state"] is not None
    assert "cycle_day_number" in data["effective_shift"]["rotation_state"]
