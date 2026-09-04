"""
Tests for the Live Duty Roster endpoint (/api/zones/duty-roster).
"""

import time
from datetime import datetime, timezone, timedelta
import pytest
import pytest_asyncio
from httpx import AsyncClient

from backend.main import app
from backend.models import Person, Camera, CameraZone, Event
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
async def test_duty_roster_with_active_shift_absent(client: AsyncClient):
    """When a person is assigned to an active shift and not seen in zone, they are marked absent."""
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
    assert item["current_absence_minutes"] >= 0
    assert item["shift_absence_minutes"] >= 0
    assert item["shift_window_str"] == "00:00 - 23:59"


@pytest.mark.asyncio
async def test_duty_roster_with_active_shift_present(client: AsyncClient):
    """When a person has a recent detection in zone, they are marked present with 0 current absence."""
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
