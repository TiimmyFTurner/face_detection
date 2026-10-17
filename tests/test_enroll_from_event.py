"""
Tests for enrolling a person from unknown detection events and snapshots.
"""

from pathlib import Path
import numpy as np
import cv2
import pytest
from httpx import AsyncClient
from unittest.mock import patch

from backend.config import settings
from backend.models import Person, Event, Camera
from tests.test_api import test_session, client, setup_database


@pytest.mark.asyncio
async def test_enroll_person_from_event_snapshot(client: AsyncClient):
    # 1. Create a dummy snapshot file in settings.snapshot_dir
    snap_dir = Path(settings.snapshot_dir)
    snap_dir.mkdir(parents=True, exist_ok=True)
    snap_filename = "test_unknown_snap_001.jpg"
    snap_path = snap_dir / snap_filename

    # Create dummy 200x200 image
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[:, :] = (120, 150, 180)
    cv2.imwrite(str(snap_path), img)

    # 2. Insert an unknown event in DB
    async with test_session() as session:
        cam = Camera(name="Entrance Camera", rtsp_url="rtsp://fake")
        session.add(cam)
        await session.commit()
        await session.refresh(cam)

        ev = Event(
            camera_id=cam.id,
            person_name="Unknown",
            is_known=False,
            confidence_score=0.15,
            snapshot_path=snap_filename,
        )
        session.add(ev)
        await session.commit()
        await session.refresh(ev)
        event_id = ev.id

    # Mock face_engine.extract_embedding_from_photo to return a 512-d vector
    fake_embedding = np.ones(512, dtype=np.float32)
    with patch("backend.routers.persons.face_engine.extract_embedding_from_photo", return_value=fake_embedding):
        # 3. Call POST /api/persons with event_ids
        resp = await client.post(
            "/api/persons",
            data={
                "name": "Sarah Connor",
                "role": "Security Specialist",
                "event_ids": f"[{event_id}]",
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "Sarah Connor"
        assert data["role"] == "Security Specialist"
        assert data["embedding_count"] == 1
        person_id = data["id"]

    # 4. Verify in DB that the Event was updated to known and linked to person
    async with test_session() as session:
        updated_ev = await session.get(Event, event_id)
        assert updated_ev.is_known is True
        assert updated_ev.person_id == person_id
        assert updated_ev.person_name == "Sarah Connor"

    # Cleanup snapshot
    try:
        snap_path.unlink(missing_ok=True)
    except Exception:
        pass


@pytest.mark.asyncio
async def test_add_photos_from_event_to_existing_person(client: AsyncClient):
    # 1. Create dummy snapshot
    snap_dir = Path(settings.snapshot_dir)
    snap_dir.mkdir(parents=True, exist_ok=True)
    snap_filename = "test_unknown_snap_002.jpg"
    snap_path = snap_dir / snap_filename

    img = np.zeros((200, 200, 3), dtype=np.uint8)
    cv2.imwrite(str(snap_path), img)

    # 2. Insert Person and Event
    async with test_session() as session:
        person = Person(name="John Doe", role="Engineer")
        session.add(person)
        await session.commit()
        await session.refresh(person)
        person_id = person.id

        ev = Event(
            person_name="Unknown",
            is_known=False,
            confidence_score=0.12,
            snapshot_path=snap_filename,
        )
        session.add(ev)
        await session.commit()
        await session.refresh(ev)
        event_id = ev.id

    fake_embedding = np.ones(512, dtype=np.float32)
    with patch("backend.routers.persons.face_engine.extract_embedding_from_photo", return_value=fake_embedding):
        resp = await client.post(
            f"/api/persons/{person_id}/photos",
            data={
                "event_ids": f"[{event_id}]",
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["embedding_count"] == 1

    async with test_session() as session:
        updated_ev = await session.get(Event, event_id)
        assert updated_ev.is_known is True
        assert updated_ev.person_id == person_id
        assert updated_ev.person_name == "John Doe"

    try:
        snap_path.unlink(missing_ok=True)
    except Exception:
        pass


@pytest.mark.asyncio
async def test_enroll_person_multiple_unknown_events(client: AsyncClient):
    # 1. Create 3 dummy snapshots
    snap_dir = Path(settings.snapshot_dir)
    snap_dir.mkdir(parents=True, exist_ok=True)
    event_ids = []
    snap_paths = []

    for i in range(3):
        snap_filename = f"test_multi_unknown_snap_{i}.jpg"
        sp = snap_dir / snap_filename
        snap_paths.append(sp)
        img = np.zeros((180, 180, 3), dtype=np.uint8)
        cv2.imwrite(str(sp), img)

        async with test_session() as session:
            ev = Event(
                person_name="Unknown",
                is_known=False,
                confidence_score=0.18,
                snapshot_path=snap_filename,
            )
            session.add(ev)
            await session.commit()
            await session.refresh(ev)
            event_ids.append(ev.id)

    # 2. Test querying /api/events with is_known=false&has_snapshot=true
    list_resp = await client.get("/api/events?is_known=false&has_snapshot=true")
    assert list_resp.status_code == 200
    listed_events = list_resp.json()["events"]
    assert len(listed_events) >= 3

    # 3. Enroll person using all 3 events
    fake_embedding = np.ones(512, dtype=np.float32)
    with patch("backend.routers.persons.face_engine.extract_embedding_from_photo", return_value=fake_embedding):
        resp = await client.post(
            "/api/persons",
            data={
                "name": "Marcus Wright",
                "role": "Supervisor",
                "event_ids": f"{event_ids}",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Marcus Wright"
        assert data["embedding_count"] == 3
        pid = data["id"]

    # 4. Verify all 3 events are now known and associated with Marcus Wright
    async with test_session() as session:
        for eid in event_ids:
            ev = await session.get(Event, eid)
            assert ev.is_known is True
            assert ev.person_id == pid
            assert ev.person_name == "Marcus Wright"

    for sp in snap_paths:
        try:
            sp.unlink(missing_ok=True)
        except Exception:
            pass
