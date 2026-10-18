"""
Tests for Duty Roster and Event Log Excel (.xlsx) and CSV exports.
"""

import io
from datetime import datetime, timezone, timedelta
import pytest
import pytest_asyncio
import openpyxl
from backend.models import Camera, CameraZone, Person, Event
from tests.test_api import test_session, test_engine, client, setup_database


# ── Duty Roster Export Tests ─────────────────────────────

@pytest.mark.asyncio
async def test_duty_roster_export_empty(client: AsyncClient):
    """Test exporting duty roster when no staff/zones exist."""
    # 1. XLSX
    res_xlsx = await client.get("/api/zones/duty-roster/export?format=xlsx")
    assert res_xlsx.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in res_xlsx.headers["content-type"]
    assert "attachment; filename=\"duty_roster_" in res_xlsx.headers["content-disposition"]
    wb = openpyxl.load_workbook(io.BytesIO(res_xlsx.content))
    assert "گزارش حضور شیفت" in wb.sheetnames
    ws = wb.active
    assert ws.sheet_view.rightToLeft is True

    # 2. CSV
    res_csv = await client.get("/api/zones/duty-roster/export?format=csv")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]
    # Check UTF-8 BOM
    assert res_csv.content.startswith(b"\xef\xbb\xbf")
    csv_text = res_csv.content.decode("utf-8")
    assert "نام پرسنل" in csv_text
    assert "طول شیفت (ساعت)" in csv_text


@pytest.mark.asyncio
async def test_duty_roster_export_with_data(client: AsyncClient):
    """Test duty roster export with active camera, zone and assigned person."""
    from backend.stream_processor import stream_processor

    async with test_session() as session:
        cam = Camera(name="Main Gate Cam", rtsp_url="rtsp://localhost/main", location="Gate", is_active=True)
        person = Person(name="Mohammad Rezaei", role="Security Guard")
        session.add_all([cam, person])
        await session.commit()
        await session.refresh(cam)
        await session.refresh(person)

        zone = CameraZone(
            camera_id=cam.id,
            name="Gate Station",
            x=10.0,
            y=10.0,
            width=50.0,
            height=50.0,
            alert_mode="absence",
            assigned_person_ids=[person.id],
            start_time="00:00",
            end_time="23:59",
            active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            is_active=True,
        )
        session.add(zone)
        await session.commit()
        await session.refresh(zone)
        zone_id = zone.id
        person_id = person.id

    # Mock person recently seen in zone so status is 'present'
    import time
    stream_processor._zone_last_seen[(zone_id, person_id)] = time.time()
    stream_processor._camera_names[cam.id] = cam.name

    # Export Excel (.xlsx)
    res_xlsx = await client.get("/api/zones/duty-roster/export?format=xlsx")
    assert res_xlsx.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(res_xlsx.content))
    ws = wb.active
    assert ws.sheet_view.rightToLeft is True

    # Search cells for person name
    all_values = [cell.value for row in ws.iter_rows() for cell in row if cell.value is not None]
    assert any("Mohammad Rezaei" in str(v) for v in all_values)
    assert any("Security Guard" in str(v) for v in all_values)
    assert any("Gate Station" in str(v) for v in all_values)

    # Export CSV (.csv)
    res_csv = await client.get("/api/zones/duty-roster/export?format=csv")
    assert res_csv.status_code == 200
    assert res_csv.content.startswith(b"\xef\xbb\xbf")
    csv_str = res_csv.content.decode("utf-8")
    assert "Mohammad Rezaei" in csv_str
    assert "Security Guard" in csv_str
    assert "Gate Station" in csv_str


# ── Events Log Export Tests ──────────────────────────────

@pytest.mark.asyncio
async def test_events_export_empty(client: AsyncClient):
    """Test exporting events when no events exist."""
    res_xlsx = await client.get("/api/events/export?format=xlsx")
    assert res_xlsx.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(res_xlsx.content))
    assert "گزارش رویدادها" in wb.sheetnames
    ws = wb.active
    assert ws.sheet_view.rightToLeft is True

    res_csv = await client.get("/api/events/export?format=csv")
    assert res_csv.status_code == 200
    assert res_csv.content.startswith(b"\xef\xbb\xbf")
    csv_text = res_csv.content.decode("utf-8")
    assert "نام فرد" in csv_text
    assert "تاریخ شمسی" in csv_text


@pytest.mark.asyncio
async def test_events_export_with_filters(client: AsyncClient):
    """Test exporting events with search, camera, and time filters."""
    now = datetime.now(timezone.utc)
    t_1h_ago = now - timedelta(hours=1)

    async with test_session() as session:
        cam1 = Camera(name="Corridor Cam", rtsp_url="rtsp://localhost/cam1", location="Corridor", is_active=True)
        cam2 = Camera(name="Vault Cam", rtsp_url="rtsp://localhost/cam2", location="Vault", is_active=True)
        session.add_all([cam1, cam2])
        await session.commit()
        await session.refresh(cam1)
        await session.refresh(cam2)

        ev1 = Event(
            camera_id=cam1.id,
            person_name="Arman Askari",
            is_known=True,
            confidence_score=0.96,
            snapshot_path="arman.jpg",
            timestamp=now,
            zone_name="Entrance",
            alert_type="normal",
        )
        ev2 = Event(
            camera_id=cam2.id,
            person_name="Unknown Intruder",
            is_known=False,
            confidence_score=0.40,
            snapshot_path="unknown.jpg",
            timestamp=t_1h_ago,
            zone_name="Safe Area",
            alert_type="unauthorized_entry",
        )
        session.add_all([ev1, ev2])
        await session.commit()

    # 1. Export Excel (.xlsx) filtered by search query
    res = await client.get("/api/events/export?format=xlsx&search=Arman")
    assert res.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    ws = wb.active
    all_values = [str(cell.value) for row in ws.iter_rows() for cell in row if cell.value is not None]
    assert any("Arman Askari" in v for v in all_values)
    assert not any("Unknown Intruder" in v for v in all_values)

    # 2. Export CSV (.csv) filtered by is_known=false
    res_csv = await client.get("/api/events/export?format=csv&is_known=false")
    assert res_csv.status_code == 200
    assert res_csv.content.startswith(b"\xef\xbb\xbf")
    csv_str = res_csv.content.decode("utf-8")
    assert "Unknown Intruder" in csv_str
    assert "Arman Askari" not in csv_str
    assert "ورود غیرمجاز" in csv_str
