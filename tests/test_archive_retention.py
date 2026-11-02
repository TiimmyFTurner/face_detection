"""
Tests for Archive Snapshot & Event Retention System.

Verifies:
  - Deletion of archived snapshot files older than retention period.
  - Setting snapshot_path = "" in events_YYYY_MM.db for expired events.
  - Preservation of archived snapshots within the retention window.
  - Cleaning of orphaned snapshot files in archive directories.
  - Total aggregation of active + archived cleaned files and freed space.
  - Archived event log purging when event_log_retention_days is set.
"""

import os
import shutil
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest
import pytest_asyncio

from backend.config import settings
from backend.models import Event, Role, User
from backend.auth import get_current_user
from backend.archive_manager import (
    get_archive_dir,
    init_archive_db,
    cleanup_archived_snapshots,
    cleanup_archived_events,
    list_monthly_archives,
    invalidate_snapshot_cache,
    find_snapshot_file,
)
from backend.snapshot_cleanup import (
    cleanup_old_snapshots,
    cleanup_old_events,
    get_storage_stats,
)
from tests.test_api import test_session, test_engine, client, setup_database


@pytest.fixture
def setup_test_archive_env(tmp_path):
    """Setup isolated active snapshot and archive folders."""
    orig_snap_dir = settings.snapshot_dir
    orig_arch_dir = settings.archive_dir

    test_snap_dir = tmp_path / "test_active_snapshots"
    test_arch_dir = tmp_path / "test_archives"
    test_snap_dir.mkdir(parents=True, exist_ok=True)
    test_arch_dir.mkdir(parents=True, exist_ok=True)

    settings.snapshot_dir = str(test_snap_dir)
    settings.archive_dir = str(test_arch_dir)
    invalidate_snapshot_cache()

    yield {
        "snap_dir": test_snap_dir,
        "arch_dir": test_arch_dir,
    }

    settings.snapshot_dir = orig_snap_dir
    settings.archive_dir = orig_arch_dir
    invalidate_snapshot_cache()


def _create_dummy_archive(
    arch_dir: Path,
    slug: str,
    events: list[dict],
    snapshots: list[tuple[str, bytes, float]],
):
    """
    Helper to create a monthly archive folder with an SQLite database and snapshots.
    events: list of dicts with keys: id, timestamp_iso, snapshot_path, person_name
    snapshots: list of (filename, content_bytes, mtime_epoch)
    """
    month_dir = arch_dir / slug
    snap_dir = month_dir / "snapshots"
    month_dir.mkdir(parents=True, exist_ok=True)
    snap_dir.mkdir(parents=True, exist_ok=True)

    db_path = month_dir / f"events_{slug}.db"
    init_archive_db(db_path)

    with sqlite3.connect(str(db_path)) as conn:
        cur = conn.cursor()
        for ev in events:
            cur.execute(
                """
                INSERT OR REPLACE INTO events (
                    id, timestamp, camera_id, person_id, person_name,
                    confidence_score, snapshot_path, is_known, zone_id,
                    zone_name, alert_type, duration_seconds
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    ev.get("id"),
                    ev.get("timestamp"),
                    ev.get("camera_id", 1),
                    ev.get("person_id", 10),
                    ev.get("person_name", "Test Person"),
                    ev.get("confidence_score", 0.95),
                    ev.get("snapshot_path", ""),
                    1 if ev.get("is_known", True) else 0,
                    ev.get("zone_id", 1),
                    ev.get("zone_name", "Main Entrance"),
                    ev.get("alert_type", "normal"),
                    ev.get("duration_seconds", 5),
                ),
            )
        conn.commit()

    for name, content, mtime in snapshots:
        file_path = snap_dir / name
        file_path.write_bytes(content)
        if mtime:
            os.utime(str(file_path), (mtime, mtime))

    return month_dir, db_path, snap_dir


@pytest.mark.asyncio
async def test_cleanup_archived_snapshots_deletes_expired_files(setup_test_archive_env):
    """Archived snapshots older than cutoff are deleted and DB snapshot_path is cleared."""
    arch_dir = setup_test_archive_env["arch_dir"]
    snap_dir_active = setup_test_archive_env["snap_dir"]

    # Suppose current date is ~Nov 2026.
    # Archive 2026_09 (September): completely older than 30 days
    sep_snap = "sep_event_01.jpg"
    sep_events = [
        {"id": 1, "timestamp": "2026-09-15T10:00:00+00:00", "snapshot_path": sep_snap, "person_name": "Sept Person"},
    ]
    sep_snaps = [(sep_snap, b"september snapshot data", time.time() - (60 * 86400))]
    _, sep_db, sep_snaps_dir = _create_dummy_archive(arch_dir, "2026_09", sep_events, sep_snaps)

    # Archive 2026_10 (October): spans across cutoff if cutoff is mid-October
    # Event 1: Oct 05 (older than 20 days)
    # Event 2: Oct 28 (newer than 20 days)
    oct_snap_old = "oct_old.jpg"
    oct_snap_recent = "oct_recent.jpg"
    oct_orphan_old = "oct_orphan_old.jpg"

    oct_events = [
        {"id": 10, "timestamp": "2026-10-05T12:00:00+00:00", "snapshot_path": oct_snap_old, "person_name": "Oct Old"},
        {"id": 11, "timestamp": "2026-10-28T12:00:00+00:00", "snapshot_path": oct_snap_recent, "person_name": "Oct Recent"},
    ]
    oct_snaps = [
        (oct_snap_old, b"october old snapshot", time.time() - (25 * 86400)),
        (oct_snap_recent, b"october recent snapshot", time.time() - (5 * 86400)),
        (oct_orphan_old, b"untracked orphan in oct", time.time() - (30 * 86400)),
    ]
    _, oct_db, oct_snaps_dir = _create_dummy_archive(arch_dir, "2026_10", oct_events, oct_snaps)

    # Cutoff: Oct 15, 2026 (UTC)
    cutoff = datetime(2026, 10, 15, 0, 0, 0, tzinfo=timezone.utc)

    deleted_count, freed_bytes, records_updated = cleanup_archived_snapshots(cutoff)

    # Expected deletions:
    # 1. 2026_09: sep_event_01.jpg
    # 2. 2026_10: oct_old.jpg
    # 3. 2026_10: oct_orphan_old.jpg
    assert deleted_count == 3
    assert records_updated == 2 # 2 DB records had snapshot_path cleared (sep #1, oct #10)
    assert freed_bytes > 0

    # Verify disk:
    assert not (sep_snaps_dir / sep_snap).exists()
    assert not (oct_snaps_dir / oct_snap_old).exists()
    assert not (oct_snaps_dir / oct_orphan_old).exists()
    assert (oct_snaps_dir / oct_snap_recent).exists(), "Recent snapshot must be kept!"

    # Verify databases:
    with sqlite3.connect(str(sep_db)) as conn:
        cur = conn.cursor()
        cur.execute("SELECT snapshot_path FROM events WHERE id = 1;")
        assert cur.fetchone()[0] == "", "September snapshot_path must be empty"

    with sqlite3.connect(str(oct_db)) as conn:
        cur = conn.cursor()
        cur.execute("SELECT snapshot_path FROM events WHERE id = 10;")
        assert cur.fetchone()[0] == "", "Oct old event snapshot_path must be empty"

        cur.execute("SELECT snapshot_path FROM events WHERE id = 11;")
        assert cur.fetchone()[0] == oct_snap_recent, "Oct recent event snapshot_path must remain"


@pytest.mark.asyncio
async def test_full_retention_flow_active_and_archive(setup_test_archive_env):
    """
    cleanup_old_snapshots combines active DB & storage and historical archives.
    """
    arch_dir = setup_test_archive_env["arch_dir"]
    snap_dir = setup_test_archive_env["snap_dir"]

    # 1. Active snapshot (45 days old)
    active_old = snap_dir / "active_45d_old.jpg"
    active_old.write_bytes(b"active old image")
    past_time = time.time() - (45 * 86400)
    os.utime(str(active_old), (past_time, past_time))

    # Active DB row
    async with test_session() as session:
        ev = Event(
            timestamp=datetime.now(timezone.utc) - timedelta(days=45),
            person_name="Active Old Person",
            snapshot_path="active_45d_old.jpg",
            is_known=True,
        )
        session.add(ev)
        await session.commit()
        await session.refresh(ev)
        active_ev_id = ev.id

    # 2. Archived month: 2026_08 (all events > 60 days old)
    aug_snap = "aug_snap_old.jpg"
    aug_events = [
        {"id": 50, "timestamp": "2026-08-10T10:00:00+00:00", "snapshot_path": aug_snap, "person_name": "Aug Old"},
    ]
    aug_snaps = [(aug_snap, b"august image bytes", time.time() - (80 * 86400))]
    _, aug_db, aug_snaps_dir = _create_dummy_archive(arch_dir, "2026_08", aug_events, aug_snaps)

    # Execute retention cleanup with 30 days retention
    res = await cleanup_old_snapshots(retention_days=30, session_factory=test_session)
    assert res["success"] is True
    # Should delete 1 active + 1 archived = 2 files
    assert res["deleted_files"] == 2
    assert res["records_removed"] == 2 # 1 active DB + 1 archive DB
    assert res["freed_bytes"] > 0
    assert "from monthly archives" in res["message"]

    # Disk assertions
    assert not active_old.exists()
    assert not (aug_snaps_dir / aug_snap).exists()

    # Active DB assertion
    async with test_session() as session:
        loaded = await session.get(Event, active_ev_id)
        assert loaded.snapshot_path == ""

    # Archive DB assertion
    with sqlite3.connect(str(aug_db)) as conn:
        cur = conn.cursor()
        cur.execute("SELECT snapshot_path FROM events WHERE id = 50;")
        assert cur.fetchone()[0] == ""


@pytest.mark.asyncio
async def test_archived_event_purging(setup_test_archive_env):
    """cleanup_old_events removes expired events from both active and archive DBs."""
    arch_dir = setup_test_archive_env["arch_dir"]

    # Create archive with old events
    old_snap = "old_event_snap.jpg"
    events = [
        {"id": 100, "timestamp": "2026-05-01T12:00:00+00:00", "snapshot_path": old_snap, "person_name": "May Person"},
    ]
    snaps = [(old_snap, b"event snap data", time.time() - (150 * 86400))]
    _, may_db, may_snaps_dir = _create_dummy_archive(arch_dir, "2026_05", events, snaps)

    # 90 days retention for event logs
    res = await cleanup_old_events(retention_days=90, session_factory=test_session)
    assert res["success"] is True
    assert res["records_removed"] >= 1
    assert not (may_snaps_dir / old_snap).exists()

    with sqlite3.connect(str(may_db)) as conn:
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM events WHERE id = 100;")
        assert cur.fetchone()[0] == 0, "Event row should be deleted from archive DB"

