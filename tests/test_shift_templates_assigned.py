"""
Tests for Shift Templates CRUD, Assigned Persons Count, and Safe Disassociation.
"""

import pytest
from httpx import AsyncClient

from backend.models import Person, ShiftTemplate
from tests.test_api import test_session, test_engine, client, setup_database


@pytest.mark.asyncio
async def test_shift_templates_assigned_persons_count_and_safe_delete(client: AsyncClient):
    """
    Verify:
      1. Creating shift template sets assigned_persons_count = 0.
      2. Assigning persons to the template reflects in list and get responses.
      3. Deleting the template cleanly disassociates assigned persons (sets shift_template_id = None).
    """
    # 1. Create a shift template
    create_payload = {
        "name": "Assembly Line Morning",
        "start_time": "07:30",
        "end_time": "15:30",
        "color": "#38bdf8",
        "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed"],
        "grace_period_minutes": 10,
        "absence_timeout_minutes": 3,
        "free_times": [
            {"name": "Morning Tea", "start_time": "09:30", "end_time": "09:45"}
        ],
    }
    res = await client.post("/api/shift-templates", json=create_payload)
    assert res.status_code == 201
    tmpl_data = res.json()
    tmpl_id = tmpl_data["id"]
    assert tmpl_data["assigned_persons_count"] == 0

    # 2. Create 2 test persons assigned to this template
    async with test_session() as session:
        p1 = Person(name="Worker One", role="Assembler", shift_template_id=tmpl_id)
        p2 = Person(name="Worker Two", role="Inspector", shift_template_id=tmpl_id)
        session.add_all([p1, p2])
        await session.commit()
        await session.refresh(p1)
        await session.refresh(p2)
        p1_id, p2_id = p1.id, p2.id

    try:
        # 3. GET list and verify assigned_persons_count is 2
        list_res = await client.get("/api/shift-templates")
        assert list_res.status_code == 200
        templates = list_res.json()
        target = next((t for t in templates if t["id"] == tmpl_id), None)
        assert target is not None
        assert target["assigned_persons_count"] == 2

        # 4. GET by ID
        get_res = await client.get(f"/api/shift-templates/{tmpl_id}")
        assert get_res.status_code == 200
        assert get_res.json()["assigned_persons_count"] == 2

        # 5. PUT update and verify count is still returned
        up_res = await client.put(f"/api/shift-templates/{tmpl_id}", json={"name": "Assembly Line Alpha"})
        assert up_res.status_code == 200
        assert up_res.json()["name"] == "Assembly Line Alpha"
        assert up_res.json()["assigned_persons_count"] == 2

        # 6. DELETE template
        del_res = await client.delete(f"/api/shift-templates/{tmpl_id}")
        assert del_res.status_code == 204

        # 7. Verify template is gone
        del_check = await client.get(f"/api/shift-templates/{tmpl_id}")
        assert del_check.status_code == 404

        # 8. Verify assigned persons have shift_template_id set to None
        async with test_session() as session:
            refreshed_p1 = await session.get(Person, p1_id)
            refreshed_p2 = await session.get(Person, p2_id)
            assert refreshed_p1.shift_template_id is None
            assert refreshed_p2.shift_template_id is None

    finally:
        # Cleanup test persons
        async with test_session() as session:
            for pid in [p1_id, p2_id]:
                p = await session.get(Person, pid)
                if p:
                    await session.delete(p)
            await session.commit()
