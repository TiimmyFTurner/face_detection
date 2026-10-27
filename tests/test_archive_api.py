"""
API Integration tests for Monthly Database and Snapshot Archiving endpoints.
"""

import pytest
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from httpx import AsyncClient, ASGITransport

from backend.main import app
from backend.config import settings
from backend.auth import create_access_token
from backend.archive_manager import init_archive_db, invalidate_snapshot_cache


@pytest.fixture(autouse=True)
def setup_api_archive_env(tmp_path, monkeypatch):
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


@pytest.mark.asyncio
async def test_api_get_archives_and_run(tmp_path):
    """Test GET /api/settings/archives and POST /api/settings/archives/run."""
    admin_token = create_access_token(1, "admin")
    headers = {"Authorization": f"Bearer {admin_token}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Initially empty
        res = await client.get("/api/settings/archives", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "archives" in data
        assert "total_archives" in data
        assert data["total_archives"] == 0

        # 2. Trigger archiving for a past month with 0 events
        post_res = await client.post(
            "/api/settings/archives/run",
            json={"year": 2026, "month": 6, "purge_from_active": True},
            headers=headers,
        )
        assert post_res.status_code == 200
        post_data = post_res.json()
        assert post_data["success"] is True
        assert post_data["year_month"] == "2026_06"

        # 3. Verify it appears in archive list
        res2 = await client.get("/api/settings/archives", headers=headers)
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["total_archives"] == 1
        assert data2["archives"][0]["year_month"] == "2026_06"


@pytest.mark.asyncio
async def test_api_serve_archived_snapshot(tmp_path):
    """Verify GET /api/snapshots/{filename} serves image from archive folder without broken links."""
    # Place a dummy image in archive month 2026_05
    arch_snaps = Path(settings.archive_dir) / "2026_05" / "snapshots"
    arch_snaps.mkdir(parents=True, exist_ok=True)
    test_img = arch_snaps / "historic_face.jpg"
    test_img.write_bytes(b"\xff\xd8\xff\xe0test_jpeg_data")

    admin_token = create_access_token(1, "admin")
    headers = {"Authorization": f"Bearer {admin_token}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/snapshots/historic_face.jpg", headers=headers)
        assert res.status_code == 200
        assert res.headers["content-type"] == "image/jpeg"
        assert res.content == b"\xff\xd8\xff\xe0test_jpeg_data"
