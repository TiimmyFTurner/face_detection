"""
Tests for Monthly Database & Snapshot Archiving and Transparent Query Routing.
"""

import os
import shutil
import sqlite3
import pytest
from datetime import datetime, timezone, timedelta
from pathlib import Path

from backend.config import settings
from backend.database import async_session
from backend.models import Event, Camera, Person
from backend.archive_manager import (
    get_archive_dir,
    get_month_date_range,
    get_month_slug,
    init_archive_db,
    find_snapshot_file,
    list_monthly_archives,
    archive_month,
    query_events_multi_db,
    invalidate_snapshot_cache,
)


@pytest.fixture(autouse=True)
def setup_test_archive_env(tmp_path, monkeypatch):
    """Isolate snapshot and archive directories in a temporary directory for tests."""
    test_snap_dir = tmp_path / "snapshots"
    test_arch_dir = tmp_path / "archives"
    test_ref_dir = tmp_path / "reference_photos"

    test_snap_dir.mkdir(parents=True, exist_ok=True)
    test_arch_dir.mkdir(parents=True, exist_ok=True)
    test_ref_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(settings, "snapshot_dir", str(test_snap_dir))
    monkeypatch.setattr(settings, "archive_dir", str(test_arch_dir))
    monkeypatch.setattr(settings, "reference_photo_dir", str(test_ref_dir))

    invalidate_snapshot_cache()
    yield
    invalidate_snapshot_cache()


def test_get_month_date_range():
    """Verify month date boundaries calculation."""
    s, e = get_month_date_range(2026, 8)
    assert s == datetime(2026, 8, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert e == datetime(2026, 9, 1, 0, 0, 0, tzinfo=timezone.utc)

    # Cross-year December test
    s_dec, e_dec = get_month_date_range(2026, 12)
    assert s_dec == datetime(2026, 12, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert e_dec == datetime(2027, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


def test_init_archive_db(tmp_path):
    """Verify archive database initialization with indexes."""
    db_file = tmp_path / "test_events.db"
    init_archive_db(db_file)
    assert db_file.is_file()

    with sqlite3.connect(str(db_file)) as conn:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='events';")
        assert cur.fetchone() is not None

        cur.execute("PRAGMA table_info(events);")
        cols = {row[1] for row in cur.fetchall()}
        assert "timestamp" in cols
        assert "snapshot_path" in cols
        assert "confidence_score" in cols


def test_find_snapshot_file_active_and_archive(tmp_path):
    """Verify transparent snapshot locator finds images in active and archive folders."""
    # 1. Create image in active directory
    snap_dir = Path(settings.snapshot_dir)
    active_img = snap_dir / "active_face_01.jpg"
    active_img.write_bytes(b"active-img-data")

    found_active = find_snapshot_file("active_face_01.jpg")
    assert found_active is not None
    assert found_active == active_img

    # 2. Create image in archive folder (e.g. 2026_07)
    arch_snap_dir = Path(settings.archive_dir) / "2026_07" / "snapshots"
    arch_snap_dir.mkdir(parents=True, exist_ok=True)
    arch_img = arch_snap_dir / "archived_face_02.jpg"
    arch_img.write_bytes(b"archived-img-data")

    # Invalidate cache to force search
    invalidate_snapshot_cache()

    found_arch = find_snapshot_file("archived_face_02.jpg")
    assert found_arch is not None
    assert found_arch == arch_img

    # 3. Non-existent file
    assert find_snapshot_file("non_existent.jpg") is None


@pytest.mark.asyncio
async def test_archive_month_workflow():
    """Verify end-to-end archiving of a month: copy events, move images, purge active DB."""
    snap_dir = Path(settings.snapshot_dir)

    # Create dummy snapshot files in active folder
    img1 = snap_dir / "snap_aug_01.jpg"
    img1.write_bytes(b"aug-img-1")
    img2 = snap_dir / "snap_sep_02.jpg"
    img2.write_bytes(b"sep-img-2")

    async with async_session() as session:
        # Create an event in August 2026
        ev_aug = Event(
            timestamp=datetime(2026, 8, 15, 10, 0, 0, tzinfo=timezone.utc),
            person_name="August Person",
            snapshot_path="snap_aug_01.jpg",
            confidence_score=0.92,
            is_known=True,
        )
        # Create an event in September 2026 (should not be archived)
        ev_sep = Event(
            timestamp=datetime(2026, 9, 5, 12, 0, 0, tzinfo=timezone.utc),
            person_name="September Person",
            snapshot_path="snap_sep_02.jpg",
            confidence_score=0.88,
            is_known=True,
        )
        session.add_all([ev_aug, ev_sep])
        await session.commit()
        await session.refresh(ev_aug)
        await session.refresh(ev_sep)

        aug_id = ev_aug.id
        sep_id = ev_sep.id

    # Run archive for August 2026
    res = await archive_month(year=2026, month=8, purge_from_active=True)
    assert res["success"] is True
    assert res["events_archived"] >= 1
    assert res["snapshots_moved"] >= 1

    # Verify snapshot moved from active to archive
    assert not (snap_dir / "snap_aug_01.jpg").exists()
    arch_img = Path(settings.archive_dir) / "2026_08" / "snapshots" / "snap_aug_01.jpg"
    assert arch_img.exists()

    # September snapshot should still be in active directory
    assert (snap_dir / "snap_sep_02.jpg").exists()

    # Verify transparent snapshot lookup finds August image in archive seamlessly
    resolved_aug = find_snapshot_file("snap_aug_01.jpg")
    assert resolved_aug == arch_img

    # Verify active DB has August event purged, but September remains
    async with async_session() as session:
        aug_check = await session.get(Event, aug_id)
        sep_check = await session.get(Event, sep_id)
        assert aug_check is None
        assert sep_check is not None

    # Clean up test event from September
    async with async_session() as session:
        sep_obj = await session.get(Event, sep_id)
        if sep_obj:
            await session.delete(sep_obj)
            await session.commit()


@pytest.mark.asyncio
async def test_query_events_multi_db():
    """Verify transparent multi-database querying combines active DB and archives with proper sorting and pagination."""
    # 1. Create an archive DB for July 2026
    arch_db_dir = Path(settings.archive_dir) / "2026_07"
    arch_db_dir.mkdir(parents=True, exist_ok=True)
    arch_db = arch_db_dir / "events_2026_07.db"
    init_archive_db(arch_db)

    with sqlite3.connect(str(arch_db)) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO events (id, timestamp, person_name, confidence_score, snapshot_path, is_known)
            VALUES (9001, '2026-07-10 08:00:00', 'July Older Event', 0.95, 'july.jpg', 1);
            """
        )
        cur.execute(
            """
            INSERT INTO events (id, timestamp, person_name, confidence_score, snapshot_path, is_known)
            VALUES (9002, '2026-07-20 14:00:00', 'July Newer Event', 0.91, 'july2.jpg', 1);
            """
        )
        conn.commit()

    # 2. Add an event to active DB in August 2026
    async with async_session() as session:
        active_ev = Event(
            timestamp=datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc),
            person_name="Active August Event",
            snapshot_path="active.jpg",
            confidence_score=0.89,
            is_known=True,
        )
        session.add(active_ev)
        await session.commit()
        await session.refresh(active_ev)
        active_id = active_ev.id

    try:
        async with async_session() as session:
            # Query covering both July and August
            rows, total = await query_events_multi_db(
                db=session,
                start_time="2026-07-01T00:00:00Z",
                end_time="2026-08-31T23:59:59Z",
                limit=10,
                offset=0,
            )

            # We should get 3 total events (1 active + 2 archived)
            assert total >= 3
            # Most recent must be the August event first
            assert rows[0]["person_name"] == "Active August Event"
            # Second must be July Newer Event (July 20)
            assert rows[1]["person_name"] == "July Newer Event"
            # Third must be July Older Event (July 10)
            assert rows[2]["person_name"] == "July Older Event"

            # Test pagination with offset=1
            page2_rows, p2_total = await query_events_multi_db(
                db=session,
                start_time="2026-07-01T00:00:00Z",
                end_time="2026-08-31T23:59:59Z",
                limit=2,
                offset=1,
            )
            assert p2_total == total
            assert len(page2_rows) == 2
            assert page2_rows[0]["person_name"] == "July Newer Event"
            assert page2_rows[1]["person_name"] == "July Older Event"

    finally:
        async with async_session() as session:
            ev_clean = await session.get(Event, active_id)
            if ev_clean:
                await session.delete(ev_clean)
                await session.commit()


def test_custom_archive_dir_resolution(tmp_path, monkeypatch):
    """Verify custom archive path and custom snapshot directory resolution."""
    # 1. Custom explicit archive_dir with quotes
    custom_dir = tmp_path / "custom_archives"
    monkeypatch.setattr(settings, "archive_dir", f'"{custom_dir}"')
    monkeypatch.setattr(settings, "snapshot_dir", "./data/snapshots")
    resolved = get_archive_dir()
    assert resolved == custom_dir.resolve()
    assert resolved.is_dir()

    # 2. Custom snapshot_dir with default archive_dir
    custom_storage = tmp_path / "remote_storage"
    custom_snaps = custom_storage / "snapshots"
    monkeypatch.setattr(settings, "archive_dir", "./data/archives")
    monkeypatch.setattr(settings, "snapshot_dir", str(custom_snaps))
    resolved_sibling = get_archive_dir()
    expected_sibling = (custom_storage / "archives").resolve()
    assert resolved_sibling == expected_sibling
    assert resolved_sibling.is_dir()

