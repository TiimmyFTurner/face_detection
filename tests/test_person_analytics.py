"""
Tests for the Person Analytics & Shift Summary endpoints and calculations.
"""

from datetime import datetime, timezone, timedelta
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from backend.main import app
from backend.database import Base, get_db
from backend.models import Person, Camera, CameraZone, Event
from tests.test_api import test_session, test_engine, client, setup_database



@pytest.mark.asyncio
async def test_list_persons_summary_empty(client: AsyncClient):
    # Insert person directly
    async with test_session() as session:
        p = Person(name="Alice Smith", role="Engineer")
        session.add(p)
        await session.commit()

    resp = await client.get("/api/persons")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    alice = data[0]
    assert alice["name"] == "Alice Smith"
    assert alice["role"] == "Engineer"
    assert "summary" in alice
    assert alice["summary"]["total_detections"] == 0
    assert alice["summary"]["today_detections"] == 0
    assert alice["summary"]["current_status"] == "never_seen"


@pytest.mark.asyncio
async def test_person_analytics_empty(client: AsyncClient):
    # Insert person directly
    async with test_session() as session:
        p = Person(name="Bob Jones", role="Security")
        session.add(p)
        await session.commit()
        await session.refresh(p)
        pid = p.id

    resp = await client.get(f"/api/persons/{pid}/analytics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["person_id"] == pid
    assert data["name"] == "Bob Jones"
    assert data["role"] == "Security"
    assert data["summary"]["total_detections"] == 0
    assert data["summary"]["avg_confidence"] == 0.0
    assert len(data["hourly_distribution"]) == 24
    assert len(data["daily_activity_last_14_days"]) == 30
    assert data["camera_distribution"] == []
    assert data["alerts"]["total_alerts"] == 0
    assert data["shifts"] == []
    assert data["shift_compliance"]["has_assigned_shift"] is False
    assert "today_absence_minutes" in data["shift_compliance"]
    assert "week_absence_minutes" in data["shift_compliance"]
    assert "month_absence_minutes" in data["shift_compliance"]
    assert "today_absence_hours_str" in data["shift_compliance"]
    assert "week_absence_hours_str" in data["shift_compliance"]
    assert "month_absence_hours_str" in data["shift_compliance"]


@pytest.mark.asyncio
async def test_person_analytics_with_shift_and_events(client: AsyncClient):
    async with test_session() as session:
        # Create person
        p = Person(name="Sara Connor", role="Supervisor")
        session.add(p)
        await session.flush()

        # Create camera
        cam = Camera(name="Main Gate", rtsp_url="rtsp://test/gate", is_active=True)
        session.add(cam)
        await session.flush()

        # Create camera zone with shift timetable (08:00 to 17:00, all days)
        zone = CameraZone(
            camera_id=cam.id,
            name="Gate Station",
            x=0.0,
            y=0.0,
            width=50.0,
            height=50.0,
            alert_mode="both",
            assigned_person_ids=[p.id],
            start_time="08:00",
            end_time="17:00",
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        )
        session.add(zone)
        await session.flush()

        now = datetime.now(timezone.utc)
        # Event 1: Today at 08:30 (Late arrival)
        ev1 = Event(
            timestamp=now.replace(hour=8, minute=30, second=0),
            camera_id=cam.id,
            person_id=p.id,
            person_name=p.name,
            confidence_score=0.92,
            snapshot_path="snap1.jpg",
            is_known=True,
            zone_id=zone.id,
            zone_name=zone.name,
            alert_type="normal",
        )
        # Event 2: Today at 16:45 (Departure)
        ev2 = Event(
            timestamp=now.replace(hour=16, minute=45, second=0),
            camera_id=cam.id,
            person_id=p.id,
            person_name=p.name,
            confidence_score=0.88,
            snapshot_path="snap2.jpg",
            is_known=True,
            zone_id=zone.id,
            zone_name=zone.name,
            alert_type="normal",
        )
        # Event 3: Security violation
        ev3 = Event(
            timestamp=now.replace(hour=12, minute=0, second=0),
            camera_id=cam.id,
            person_id=p.id,
            person_name=p.name,
            confidence_score=0.94,
            snapshot_path="snap3.jpg",
            is_known=True,
            zone_id=zone.id,
            zone_name=zone.name,
            alert_type="out_of_zone",
        )
        session.add_all([ev1, ev2, ev3])
        await session.commit()
        pid = p.id

    resp = await client.get(f"/api/persons/{pid}/analytics")
    assert resp.status_code == 200
    data = resp.json()

    assert data["person_id"] == pid
    assert data["summary"]["total_detections"] == 3
    assert data["summary"]["avg_confidence"] > 90.0
    assert len(data["shifts"]) == 1
    assert data["shifts"][0]["zone_name"] == "Gate Station"
    assert data["shifts"][0]["shift_duration_hours"] == 9.0
    assert data["shift_compliance"]["has_assigned_shift"] is True
    assert data["alerts"]["out_of_zone_count"] == 1
    assert data["alerts"]["total_alerts"] == 1
    assert len(data["camera_distribution"]) == 1
    assert data["camera_distribution"][0]["camera_name"] == "Main Gate"
    assert data["camera_distribution"][0]["percentage"] == 100.0
    assert len(data["recent_events"]) == 3


@pytest.mark.asyncio
async def test_person_analytics_404(client: AsyncClient):
    resp = await client.get("/api/persons/99999/analytics")
    assert resp.status_code == 404
