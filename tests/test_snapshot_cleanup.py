"""
Automated tests for Snapshot and Event Log Retention System.

Verifies:
  - Deletion of snapshots older than retention threshold.
  - Retention of snapshots within threshold.
  - Clearing event.snapshot_path in SQLite without breaking event log.
  - Purging of expired event records from SQLite when log retention is set.
  - Protection of reference photos (never deleted).
  - Cleaning of orphaned snapshot files on disk.
  - Accurate storage usage calculation (counts, MB).
  - API endpoints (GET /api/settings, PATCH /api/settings, GET /storage-stats, POST /cleanup-*).
"""

import os
import shutil
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest
import pytest_asyncio
from httpx import AsyncClient

from backend.main import app
from backend.config import settings
from backend.models import Event, Role, User
from backend.auth import get_current_user
from backend.snapshot_cleanup import (
    cleanup_old_snapshots,
    cleanup_old_events,
    get_storage_stats,
    update_env_file,
)
from tests.test_api import test_session, test_engine, client, setup_database


# ── Mock Authenticated Admin User for Protected Endpoints ──────────
async def mock_admin_user():
    admin_role = Role(name="admin", display_name="Admin", permissions=["*"])
    return User(
        id=1,
        username="admin",
        full_name="System Administrator",
        is_active=True,
        role=admin_role,
        custom_permissions=["*"],
    )


@pytest.fixture(autouse=True)
def setup_test_environment(tmp_path):
    """Override snapshot directory with a temporary directory for tests and mock auth."""
    app.dependency_overrides[get_current_user] = mock_admin_user
    original_snap_dir = settings.snapshot_dir
    test_snap_dir = str(tmp_path / "test_snapshots")
    os.makedirs(test_snap_dir, exist_ok=True)
    settings.snapshot_dir = test_snap_dir

    yield test_snap_dir

    # Cleanup
    settings.snapshot_dir = original_snap_dir
    app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_cleanup_disabled_when_zero(setup_test_environment):
    """When retention_days is 0 (No Expiry), cleanup returns early without deleting anything."""
    test_dir = Path(setup_test_environment)
    old_file = test_dir / "old_snap.jpg"
    old_file.write_bytes(b"dummy image content")

    res = await cleanup_old_snapshots(retention_days=0, session_factory=test_session)
    assert res["success"] is True
    assert res["deleted_files"] == 0
    assert old_file.exists()


@pytest.mark.asyncio
async def test_cleanup_old_snapshots_deletes_file_and_clears_db(setup_test_environment):
    """Snapshots older than cutoff are deleted from disk and snapshot_path is cleared in DB."""
    test_dir = Path(setup_test_environment)

    # 1. Old snapshot (40 days old)
    old_filename = "snap_40d_old.jpg"
    old_path = test_dir / old_filename
    old_path.write_bytes(b"image data from 40 days ago")
    # Set file mtime to 40 days ago
    past_time = time.time() - (40 * 86400)
    os.utime(str(old_path), (past_time, past_time))

    # 2. Recent snapshot (2 days old)
    recent_filename = "snap_2d_recent.jpg"
    recent_path = test_dir / recent_filename
    recent_path.write_bytes(b"recent image data")

    # Insert events into DB
    async with test_session() as session:
        ev_old = Event(
            timestamp=datetime.now(timezone.utc) - timedelta(days=40),
            person_name="John Old",
            snapshot_path=old_filename,
            is_known=True,
        )
        ev_recent = Event(
            timestamp=datetime.now(timezone.utc) - timedelta(days=2),
            person_name="Jane Recent",
            snapshot_path=recent_filename,
            is_known=True,
        )
        session.add_all([ev_old, ev_recent])
        await session.commit()
        await session.refresh(ev_old)
        await session.refresh(ev_recent)
        old_id = ev_old.id
        recent_id = ev_recent.id

    # Execute cleanup with 7 days retention
    res = await cleanup_old_snapshots(retention_days=7, session_factory=test_session)
    assert res["success"] is True
    assert res["deleted_files"] == 1
    assert res["records_removed"] == 1
    assert res["freed_bytes"] > 0

    # Verify disk state
    assert not old_path.exists(), "Old snapshot file should have been deleted"
    assert recent_path.exists(), "Recent snapshot file should be preserved"

    # Verify DB state: old event log is kept intact, but snapshot_path is cleared
    async with test_session() as session:
        reloaded_old = await session.get(Event, old_id)
        assert reloaded_old is not None
        assert reloaded_old.person_name == "John Old"
        assert reloaded_old.snapshot_path == "", "Old event snapshot_path should be cleared to empty string"

        reloaded_recent = await session.get(Event, recent_id)
        assert reloaded_recent is not None
        assert reloaded_recent.snapshot_path == recent_filename, "Recent event snapshot_path should remain intact"


@pytest.mark.asyncio
async def test_reference_photos_are_never_deleted(setup_test_environment):
    """Files starting with ref_ must never be deleted by snapshot cleanup."""
    test_dir = Path(setup_test_environment)
    ref_file = test_dir / "ref_face_portrait.jpg"
    ref_file.write_bytes(b"reference biometric photo")
    past_time = time.time() - (100 * 86400)
    os.utime(str(ref_file), (past_time, past_time))

    async with test_session() as session:
        ev = Event(
            timestamp=datetime.now(timezone.utc) - timedelta(days=100),
            person_name="VIP Person",
            snapshot_path="ref_face_portrait.jpg",
            is_known=True,
        )
        session.add(ev)
        await session.commit()

    res = await cleanup_old_snapshots(retention_days=7, session_factory=test_session)
    assert ref_file.exists(), "Reference photo must NEVER be deleted by retention cleaner"


@pytest.mark.asyncio
async def test_orphaned_snapshots_cleanup(setup_test_environment):
    """Orphaned files on disk (not linked to DB events) older than cutoff are deleted."""
    test_dir = Path(setup_test_environment)
    orphaned_file = test_dir / "orphaned_untracked.jpg"
    orphaned_file.write_bytes(b"orphaned picture file")
    past_time = time.time() - (50 * 86400)
    os.utime(str(orphaned_file), (past_time, past_time))

    res = await cleanup_old_snapshots(retention_days=14, session_factory=test_session)
    assert res["deleted_files"] == 1
    assert not orphaned_file.exists()


@pytest.mark.asyncio
async def test_cleanup_old_events_purges_db_and_disk(setup_test_environment):
    """Event log retention removes DB records and associated disk files older than retention days."""
    test_dir = Path(setup_test_environment)

    old_file = test_dir / "ev_to_delete.jpg"
    old_file.write_bytes(b"event image to delete")

    recent_file = test_dir / "ev_to_keep.jpg"
    recent_file.write_bytes(b"event image to keep")

    async with test_session() as session:
        ev_old = Event(
            timestamp=datetime.now(timezone.utc) - timedelta(days=60),
            person_name="To Purge",
            snapshot_path="ev_to_delete.jpg",
        )
        ev_recent = Event(
            timestamp=datetime.now(timezone.utc) - timedelta(days=5),
            person_name="To Keep",
            snapshot_path="ev_to_keep.jpg",
        )
        session.add_all([ev_old, ev_recent])
        await session.commit()
        await session.refresh(ev_old)
        await session.refresh(ev_recent)
        old_id = ev_old.id
        recent_id = ev_recent.id

    # Run event log cleanup with 30 days retention
    res = await cleanup_old_events(retention_days=30, session_factory=test_session)
    assert res["success"] is True
    assert res["records_removed"] == 1
    assert res["deleted_files"] == 1

    # Verify DB: old event purged, recent event preserved
    async with test_session() as session:
        assert await session.get(Event, old_id) is None
        assert await session.get(Event, recent_id) is not None

    # Verify disk
    assert not old_file.exists()
    assert recent_file.exists()


@pytest.mark.asyncio
async def test_storage_stats(setup_test_environment):
    """Storage stats correctly counts snapshots on disk and events in database."""
    test_dir = Path(setup_test_environment)
    f1 = test_dir / "s1.jpg"
    f2 = test_dir / "s2.jpg"
    f1.write_bytes(b"x" * 1024)
    f2.write_bytes(b"y" * 2048)

    async with test_session() as session:
        ev = Event(
            timestamp=datetime.now(timezone.utc),
            person_name="Test User",
            snapshot_path="s1.jpg",
        )
        session.add(ev)
        await session.commit()

    stats = await get_storage_stats(session_factory=test_session)
    assert stats["snapshot_count"] == 2
    assert stats["total_bytes"] == 3072
    assert stats["event_count"] == 1


@pytest.mark.asyncio
async def test_api_settings_and_cleanup_endpoints(client: AsyncClient, setup_test_environment):
    """Verify GET/PATCH settings and storage-stats and cleanup endpoints."""
    # 1. Get settings
    get_resp = await client.get("/api/settings")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert "snapshot_retention_days" in data
    assert "event_log_retention_days" in data

    # 2. Patch retention settings
    patch_resp = await client.patch("/api/settings", json={
        "snapshot_retention_days": 7,
        "event_log_retention_days": 90,
    })
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["snapshot_retention_days"] == 7
    assert updated["event_log_retention_days"] == 90

    # 3. Storage stats endpoint
    stats_resp = await client.get("/api/settings/storage-stats")
    assert stats_resp.status_code == 200
    s_data = stats_resp.json()
    assert "snapshot_count" in s_data
    assert "total_mb" in s_data
    assert "event_count" in s_data

    # 4. Cleanup snapshots endpoint
    clean_snap_resp = await client.post("/api/settings/cleanup-snapshots?retention_days=1")
    assert clean_snap_resp.status_code == 200
    cs_data = clean_snap_resp.json()
    assert cs_data["success"] is True

    # 5. Cleanup logs endpoint
    clean_logs_resp = await client.post("/api/settings/cleanup-logs?retention_days=30")
    assert clean_logs_resp.status_code == 200
    cl_data = clean_logs_resp.json()
    assert cl_data["success"] is True
