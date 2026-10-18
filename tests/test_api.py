"""
API integration tests using FastAPI TestClient.
Tests all CRUD endpoints for cameras, persons, and events.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from backend.main import app
from backend.database import Base, get_db


# ── Test Database Setup ──────────────────────────────────
TEST_DB_URL = "sqlite+aiosqlite:///./data/test_face_tracking.db"

test_engine = create_async_engine(TEST_DB_URL, echo=False)
test_session = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db():
    async with test_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


from backend.auth import get_current_user
from backend.models import User, Role

mock_admin = User(
    id=1,
    username="admin",
    full_name="Admin",
    is_active=True,
    custom_permissions=["*"],
    role=Role(id=1, name="admin", permissions=["*"]),
)

async def override_get_current_user():
    return mock_admin

app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_current_user] = override_get_current_user

import backend.stream_processor
backend.stream_processor.async_session = test_session


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """Create tables before each test, drop after."""
    from backend.stream_processor import stream_processor
    stream_processor._zones_cache.clear()
    stream_processor._camera_names.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    stream_processor._zones_cache.clear()
    stream_processor._camera_names.clear()


@pytest_asyncio.fixture
async def client():
    """Async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ═══════════════════════════════════════════════════════════
# Health Check
# ═══════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data


# ═══════════════════════════════════════════════════════════
# Camera CRUD Tests
# ═══════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_create_camera(client: AsyncClient):
    response = await client.post("/api/cameras", json={
        "name": "Test Camera",
        "rtsp_url": "rtsp://test:test@192.168.1.1:554/stream",
        "location": "Front Door",
        "is_active": False,  # Don't try to connect in tests
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Camera"
    assert data["rtsp_url"] == "rtsp://test:test@192.168.1.1:554/stream"
    assert data["location"] == "Front Door"
    assert data["is_active"] is False


@pytest.mark.asyncio
async def test_list_cameras(client: AsyncClient):
    # Create two cameras
    await client.post("/api/cameras", json={
        "name": "Camera 1",
        "rtsp_url": "rtsp://test@192.168.1.1/stream",
        "is_active": False,
    })
    await client.post("/api/cameras", json={
        "name": "Camera 2",
        "rtsp_url": "rtsp://test@192.168.1.2/stream",
        "is_active": False,
    })

    response = await client.get("/api/cameras")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


@pytest.mark.asyncio
async def test_get_camera(client: AsyncClient):
    create_resp = await client.post("/api/cameras", json={
        "name": "My Camera",
        "rtsp_url": "rtsp://test@192.168.1.1/stream",
        "is_active": False,
    })
    camera_id = create_resp.json()["id"]

    response = await client.get(f"/api/cameras/{camera_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "My Camera"


@pytest.mark.asyncio
async def test_update_camera(client: AsyncClient):
    create_resp = await client.post("/api/cameras", json={
        "name": "Old Name",
        "rtsp_url": "rtsp://test@192.168.1.1/stream",
        "is_active": False,
    })
    camera_id = create_resp.json()["id"]

    response = await client.put(f"/api/cameras/{camera_id}", json={
        "name": "New Name",
        "location": "Back Yard",
    })
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"
    assert response.json()["location"] == "Back Yard"


@pytest.mark.asyncio
async def test_delete_camera(client: AsyncClient):
    from backend.models import CameraZone, Event
    from backend.stream_processor import stream_processor
    from sqlalchemy import select

    # 1. Create a camera
    create_resp = await client.post("/api/cameras", json={
        "name": "To Delete",
        "rtsp_url": "rtsp://test@192.168.1.1/stream",
        "is_active": True,
    })
    camera_id = create_resp.json()["id"]

    # 2. Create a zone on this camera
    zone_resp = await client.post(f"/api/cameras/{camera_id}/zones", json={
        "name": "Zone To Delete",
        "x": 10.0,
        "y": 10.0,
        "width": 50.0,
        "height": 50.0,
        "alert_mode": "absence",
    })
    assert zone_resp.status_code == 201

    # 3. Add a normal detection event and a camera_disconnected event
    async with test_session() as session:
        normal_evt = Event(camera_id=camera_id, person_name="Tiimmy", alert_type="normal", snapshot_path="test.jpg")
        disc_evt = Event(camera_id=camera_id, person_name="Tiimmy", alert_type="camera_disconnected", snapshot_path="test2.jpg")
        session.add_all([normal_evt, disc_evt])
        await session.commit()

    # Verify stream_processor cached zones for this camera
    assert camera_id in stream_processor._zones_cache

    # 4. Delete the camera
    response = await client.delete(f"/api/cameras/{camera_id}")
    assert response.status_code == 204

    # Verify camera is gone
    get_resp = await client.get(f"/api/cameras/{camera_id}")
    assert get_resp.status_code == 404

    # Verify stream_processor cache purged the camera
    assert camera_id not in stream_processor._zones_cache

    # Verify zones for this camera were deleted from DB
    async with test_session() as session:
        zones_res = await session.execute(select(CameraZone).where(CameraZone.camera_id == camera_id))
        assert len(zones_res.scalars().all()) == 0

        # Disconnect alert event was removed
        disc_res = await session.execute(select(Event).where(Event.alert_type == "camera_disconnected"))
        assert len(disc_res.scalars().all()) == 0

        # Normal detection event had camera_id unlinked (set to NULL)
        normal_res = await session.execute(select(Event).where(Event.person_name == "Tiimmy"))
        events = normal_res.scalars().all()
        assert len(events) == 1
        assert events[0].camera_id is None


@pytest.mark.asyncio
async def test_get_nonexistent_camera(client: AsyncClient):
    response = await client.get("/api/cameras/9999")
    assert response.status_code == 404


# ═══════════════════════════════════════════════════════════
# Events Tests
# ═══════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_list_events_empty(client: AsyncClient):
    response = await client.get("/api/events")
    assert response.status_code == 200
    data = response.json()
    assert data["events"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_event_stats(client: AsyncClient):
    response = await client.get("/api/events/stats")
    assert response.status_code == 200
    data = response.json()
    assert "total_today" in data
    assert "known_today" in data
    assert "unknown_today" in data
    assert "active_cameras" in data


@pytest.mark.asyncio
async def test_grouped_events(client: AsyncClient):
    response = await client.get("/api/events/grouped")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_events_search_and_time_filters(client: AsyncClient):
    from datetime import datetime, timezone, timedelta
    from backend.models import Camera, Event

    now = datetime.now(timezone.utc)
    t_2h_ago = now - timedelta(hours=2)
    t_1h_ago = now - timedelta(hours=1)
    t_10m_ago = now - timedelta(minutes=10)

    async with test_session() as session:
        cam1 = Camera(name="Front Gate Cam", rtsp_url="rtsp://localhost/cam1", location="Entrance", is_active=False)
        cam2 = Camera(name="Warehouse Cam", rtsp_url="rtsp://localhost/cam2", location="Storage", is_active=False)
        session.add_all([cam1, cam2])
        await session.commit()
        await session.refresh(cam1)
        await session.refresh(cam2)

        ev1 = Event(
            camera_id=cam1.id,
            person_name="Alice Smith",
            is_known=True,
            confidence_score=0.95,
            snapshot_path="alice.jpg",
            timestamp=t_2h_ago,
        )
        ev2 = Event(
            camera_id=cam2.id,
            person_name="Bob Jones",
            is_known=True,
            confidence_score=0.88,
            snapshot_path="bob.jpg",
            timestamp=t_1h_ago,
        )
        ev3 = Event(
            camera_id=cam1.id,
            person_name="Charlie Brown",
            is_known=False,
            confidence_score=0.45,
            snapshot_path="charlie.jpg",
            timestamp=t_10m_ago,
        )
        session.add_all([ev1, ev2, ev3])
        await session.commit()
        cam1_id, cam2_id = cam1.id, cam2.id

    # 1. Search by person name
    res = await client.get("/api/events?search=Alice")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["events"][0]["person_name"] == "Alice Smith"

    # 2. Search by camera name (e.g. Warehouse)
    res = await client.get("/api/events?search=Warehouse")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["events"][0]["person_name"] == "Bob Jones"
    assert data["events"][0]["camera_id"] == cam2_id

    # 3. Search by camera location (Entrance)
    res = await client.get("/api/events?search=Entrance")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    names = {e["person_name"] for e in data["events"]}
    assert names == {"Alice Smith", "Charlie Brown"}

    # 4. Filter by specific camera_id
    res = await client.get(f"/api/events?camera_id={cam2_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["events"][0]["person_name"] == "Bob Jones"

    # 5. Filter by time window (past 30 mins)
    t_30m_ago_iso = (now - timedelta(minutes=30)).isoformat()
    now_iso = now.isoformat()
    res = await client.get(f"/api/events?start_time={t_30m_ago_iso}&end_time={now_iso}")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["events"][0]["person_name"] == "Charlie Brown"

    # 6. Combined filter: camera1 + is_known=true
    res = await client.get(f"/api/events?camera_id={cam1_id}&is_known=true")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["events"][0]["person_name"] == "Alice Smith"

    # 7. Grouped events with search filter
    res = await client.get("/api/events/grouped?search=Alice")
    assert res.status_code == 200
    groups = res.json()
    assert len(groups) == 1
    assert groups[0]["person_name"] == "Alice Smith"

    # 8. Grouped events with camera filter
    res = await client.get(f"/api/events/grouped?camera_id={cam2_id}")
    assert res.status_code == 200
    groups = res.json()
    assert len(groups) == 1
    assert groups[0]["person_name"] == "Bob Jones"

    # 9. Grouped events with time window filter
    res = await client.get(f"/api/events/grouped?start_time={t_30m_ago_iso}")
    assert res.status_code == 200
    groups = res.json()
    assert len(groups) == 1
    assert groups[0]["person_name"] == "Charlie Brown"


@pytest.mark.asyncio
async def test_delete_nonexistent_event(client: AsyncClient):
    response = await client.delete("/api/events/999999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"


# ═══════════════════════════════════════════════════════════
# Snapshot Tests
# ═══════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_snapshot_not_found(client: AsyncClient):
    response = await client.get("/api/snapshots/nonexistent.jpg")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_snapshot_path_traversal(client: AsyncClient):
    response = await client.get("/api/snapshots/..%2F..%2Fetc%2Fpasswd")
    assert response.status_code in (400, 404)


@pytest.mark.asyncio
async def test_camera_snapshot_and_stream(client: AsyncClient):
    from backend.stream_processor import stream_processor
    # Create camera
    resp = await client.post("/api/cameras", json={
        "name": "Live Test Cam",
        "rtsp_url": "rtsp://invalid_url_for_test",
        "is_active": False,
    })
    cam_id = resp.json()["id"]

    # Provide a mock frame so test does not block on external RTSP timeout
    stream_processor._latest_frames[cam_id] = b"\xff\xd8\xff\xe0test_jpeg_bytes\xff\xd9"

    # Test camera snapshot endpoint
    snap_resp = await client.get(f"/api/cameras/{cam_id}/snapshot")
    assert snap_resp.status_code == 200
    assert snap_resp.headers.get("content-type") == "image/jpeg"

    # Test camera stream endpoint - read first frame and break
    async with client.stream("GET", f"/api/cameras/{cam_id}/stream?max_frames=1") as stream_resp:
        assert stream_resp.status_code == 200
        assert "multipart/x-mixed-replace" in stream_resp.headers.get("content-type", "")
        async for chunk in stream_resp.aiter_bytes():
            assert len(chunk) > 0

    # Clean up mock frame
    stream_processor._latest_frames.pop(cam_id, None)

    # Nonexistent camera snapshot
    bad_snap = await client.get("/api/cameras/99999/snapshot")
    assert bad_snap.status_code == 404


# ═══════════════════════════════════════════════════════════
# Camera Zone / Important Area Tests
# ═══════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_create_and_list_camera_zones(client: AsyncClient):
    # Create camera first
    cam_resp = await client.post("/api/cameras", json={
        "name": "Zone Test Cam",
        "rtsp_url": "rtsp://localhost/test",
        "is_active": False,
    })
    cam_id = cam_resp.json()["id"]

    # Create zone
    zone_resp = await client.post(f"/api/cameras/{cam_id}/zones", json={
        "name": "Work Desk A",
        "x": 10.0,
        "y": 15.0,
        "width": 30.0,
        "height": 40.0,
        "alert_mode": "absence",
        "assigned_person_ids": [1],
        "is_active": True,
    })
    assert zone_resp.status_code == 201
    zone_data = zone_resp.json()
    assert zone_data["name"] == "Work Desk A"
    assert zone_data["camera_id"] == cam_id
    assert zone_data["assigned_person_ids"] == [1]
    zone_id = zone_data["id"]

    # List camera zones
    list_resp = await client.get(f"/api/cameras/{cam_id}/zones")
    assert list_resp.status_code == 200
    zones = list_resp.json()
    assert len(zones) >= 1
    assert any(z["id"] == zone_id for z in zones)


@pytest.mark.asyncio
async def test_update_and_delete_camera_zone(client: AsyncClient):
    # Create camera
    cam_resp = await client.post("/api/cameras", json={
        "name": "Zone Cam 2",
        "rtsp_url": "rtsp://localhost/test2",
        "is_active": False,
    })
    cam_id = cam_resp.json()["id"]

    # Create zone
    create_resp = await client.post(f"/api/cameras/{cam_id}/zones", json={
        "name": "Cashier",
        "x": 20.0,
        "y": 20.0,
        "width": 50.0,
        "height": 50.0,
        "alert_mode": "unauthorized",
        "assigned_person_ids": [2],
    })
    zone_id = create_resp.json()["id"]

    # Update zone
    update_resp = await client.put(f"/api/zones/{zone_id}", json={
        "name": "Updated Cashier",
        "alert_mode": "both",
    })
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Updated Cashier"
    assert update_resp.json()["alert_mode"] == "both"

    # Delete zone
    del_resp = await client.delete(f"/api/zones/{zone_id}")
    assert del_resp.status_code == 204

    # Verify deleted
    get_resp = await client.get(f"/api/zones/{zone_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_zone_status_and_logs(client: AsyncClient):
    # Create camera and zone with timetable
    cam_resp = await client.post("/api/cameras", json={
        "name": "Status Cam",
        "rtsp_url": "rtsp://localhost/status_test",
        "is_active": False,
    })
    cam_id = cam_resp.json()["id"]

    zone_resp = await client.post(f"/api/cameras/{cam_id}/zones", json={
        "name": "Status Zone",
        "x": 5.0,
        "y": 5.0,
        "width": 40.0,
        "height": 40.0,
        "alert_mode": "absence",
        "assigned_person_ids": [1],
        "start_time": "08:00",
        "end_time": "18:00",
        "active_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    })
    assert zone_resp.status_code == 201

    # Test GET /api/zones/status
    status_resp = await client.get("/api/zones/status")
    assert status_resp.status_code == 200
    status_list = status_resp.json()
    assert isinstance(status_list, list)
    assert len(status_list) >= 1

    # Test GET /api/zones/logs
    logs_resp = await client.get("/api/zones/logs")
    assert logs_resp.status_code == 200
    logs = logs_resp.json()
    assert "events" in logs

@pytest.mark.asyncio
async def test_legacy_zone_backward_compatibility(client: AsyncClient):
    # Insert a legacy CameraZone directly with NULL fields
    from backend.models import Camera, CameraZone

    async with test_session() as session:
        cam = Camera(name="Legacy Cam", rtsp_url="rtsp://localhost/legacy", is_active=False)
        session.add(cam)
        await session.commit()
        await session.refresh(cam)

        legacy_zone = CameraZone(
            camera_id=cam.id,
            name="Old Legacy Area",
            x=10.0,
            y=10.0,
            width=30.0,
            height=30.0,
            alert_mode=None,
            assigned_person_ids=None,
            start_time=None,
            end_time=None,
            active_days=None,
        )
        session.add(legacy_zone)
        await session.commit()
        await session.refresh(legacy_zone)
        cam_id = cam.id

    # Verify listing all zones works and doesn't 500
    all_zones_resp = await client.get("/api/zones")
    assert all_zones_resp.status_code == 200
    all_zones = all_zones_resp.json()
    assert any(z["name"] == "Old Legacy Area" for z in all_zones)

    # Verify camera-scoped zones endpoint works
    cam_zones_resp = await client.get(f"/api/cameras/{cam_id}/zones")
    assert cam_zones_resp.status_code == 200
    cam_zones = cam_zones_resp.json()
    assert len(cam_zones) == 1
    assert cam_zones[0]["assigned_person_ids"] == []
    assert cam_zones[0]["start_time"] == "00:00"

    # Verify status board endpoint works
    status_resp = await client.get("/api/zones/status")
    assert status_resp.status_code == 200


@pytest.mark.asyncio
async def test_reindex_embeddings_endpoint(client: AsyncClient):
    response = await client.post("/api/persons/reindex-embeddings")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "updated" in data

