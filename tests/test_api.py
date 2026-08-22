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


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """Create tables before each test, drop after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


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
    create_resp = await client.post("/api/cameras", json={
        "name": "To Delete",
        "rtsp_url": "rtsp://test@192.168.1.1/stream",
        "is_active": False,
    })
    camera_id = create_resp.json()["id"]

    response = await client.delete(f"/api/cameras/{camera_id}")
    assert response.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/cameras/{camera_id}")
    assert get_resp.status_code == 404


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
    # Create camera
    resp = await client.post("/api/cameras", json={
        "name": "Live Test Cam",
        "rtsp_url": "rtsp://invalid_url_for_test",
        "is_active": False,
    })
    cam_id = resp.json()["id"]

    # Test camera snapshot endpoint
    snap_resp = await client.get(f"/api/cameras/{cam_id}/snapshot")
    assert snap_resp.status_code in (200, 503)

    # Test camera stream endpoint
    async with client.stream("GET", f"/api/cameras/{cam_id}/stream") as stream_resp:
        assert stream_resp.status_code == 200
        assert "multipart/x-mixed-replace" in stream_resp.headers.get("content-type", "")

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
