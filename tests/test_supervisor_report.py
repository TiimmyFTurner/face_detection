"""
Tests for Supervisor Daily Attendance Report & Excel (.xlsx) Export.
"""

from datetime import datetime, timezone, timedelta
import io
import pytest
from httpx import AsyncClient
import openpyxl

from backend.models import Camera, CameraZone, Person, Event, Role, User
from backend.auth import get_current_user
from backend.stream_processor import stream_processor
from tests.test_api import test_session, client, setup_database


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


async def mock_supervisor_user():
    sup_role = Role(name="supervisor", display_name="Supervisor", permissions=["duty:view", "persons:view"])
    return User(
        id=2,
        username="peyman",
        full_name="Ali Peyman",
        is_active=True,
        role=sup_role,
        custom_permissions=["duty:view", "persons:view"],
        assigned_sections=["Packaging"],
        assigned_person_ids=[],
        assigned_camera_ids=[],
    )


@pytest.mark.asyncio
async def test_supervisor_attendance_report_json_and_excel(client: AsyncClient, monkeypatch):
    from backend.main import app
    app.dependency_overrides[get_current_user] = mock_supervisor_user
    monkeypatch.setattr(stream_processor, "is_camera_online", lambda cid: True)

    target_date_str = "2026-11-02"
    t_date = datetime.strptime(target_date_str, "%Y-%m-%d").date()
    now_local = datetime.now()

    try:
        async with test_session() as session:
            cam = Camera(name="Packaging Camera", rtsp_url="rtsp://127.0.0.1/pack_cam", is_active=True, section="Packaging")
            session.add(cam)
            await session.flush()

            # Person 1 in Packaging (present today)
            p1 = Person(name="Zahra Rahimi", role="Operator", section="Packaging")
            # Person 2 in Packaging (on leave today)
            p2 = Person(
                name="Siavash Leave",
                role="Operator",
                section="Packaging",
                leaves=[{"start_date": target_date_str, "end_date": target_date_str, "leave_type": "daily_leave", "note": "استعلاجی"}],
            )
            # Person 3 in Production (different section, should be scoped out for this supervisor)
            p3 = Person(name="Out of Scope Staff", role="Tech", section="Production")
            session.add_all([p1, p2, p3])
            await session.flush()

            zone = CameraZone(
                name="Packaging Line 1",
                camera_id=cam.id,
                x=0,
                y=0,
                width=100,
                height=100,
                assigned_person_ids=[p1.id, p2.id],
                start_time="07:00",
                end_time="15:00",
                active_days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                absence_timeout_minutes=5,
                grace_period_minutes=10,
                free_times=[{"name": "Lunch", "start_time": "12:00", "end_time": "13:00"}],
                is_active=True,
            )
            session.add(zone)
            await session.commit()
            p1_id = p1.id
            p2_id = p2.id
            p3_id = p3.id

        # Add event for p1 (sighted at 07:05, on time)
        event_dt = datetime(t_date.year, t_date.month, t_date.day, 7, 5, 0).astimezone(timezone.utc)
        async with test_session() as session:
            ev = Event(
                camera_id=cam.id,
                person_id=p1_id,
                person_name="Zahra Rahimi",
                timestamp=event_dt,
                snapshot_path="snap.jpg",
                alert_type="normal",
            )
            session.add(ev)
            await session.commit()

        # 1. Test JSON report endpoint
        resp = await client.get(f"/api/zones/supervisor/attendance-report?date={target_date_str}")
        assert resp.status_code == 200
        data = resp.json()

        assert data["date"] == target_date_str
        assert data["total_staff"] == 2  # P1 and P2 in Packaging (P3 excluded by scope!)
        records = data["records"]
        rec_ids = [r["person_id"] for r in records]
        assert p1_id in rec_ids
        assert p2_id in rec_ids
        assert p3_id not in rec_ids

        # Check p2 (on leave)
        p2_rec = next(r for r in records if r["person_id"] == p2_id)
        assert p2_rec["status_code"] == "leave"
        assert p2_rec["compliance_pct"] == 100.0

        # Check p1 (present)
        p1_rec = next(r for r in records if r["person_id"] == p1_id)
        assert p1_rec["arrival_time"] == "07:05:00"
        assert p1_rec["arrival_delay_str"] == "به موقع"

        # 2. Test Excel (.xlsx) export endpoint
        export_resp = await client.get(f"/api/zones/supervisor/attendance-report/export?date={target_date_str}")
        assert export_resp.status_code == 200
        assert "spreadsheetml.sheet" in export_resp.headers["content-type"]
        assert f"supervisor_attendance_{target_date_str}.xlsx" in export_resp.headers["content-disposition"]

        # Parse with openpyxl to verify workbook integrity
        wb = openpyxl.load_workbook(io.BytesIO(export_resp.content))
        ws = wb.active
        assert ws.sheet_view.rightToLeft is True
        assert "گزارش جامع حضور و غیاب پرسنل" in ws["A1"].value
        assert "Ali Peyman" in ws["A2"].value

        # Verify headers in Row 7
        row_7_vals = [ws.cell(row=7, column=c).value for c in range(1, 17)]
        assert "ردیف" in row_7_vals
        assert "نام و نام خانوادگی" in row_7_vals
        assert "درصد انضباط شیفت" in row_7_vals

        # Verify data rows
        row_8_name = ws.cell(row=8, column=2).value
        assert row_8_name in ("Zahra Rahimi", "Siavash Leave")

    finally:
        app.dependency_overrides.pop(get_current_user, None)

def test_get_relevant_archive_dbs_naive_and_aware(tmp_path, monkeypatch):
    """Verify get_relevant_archive_dbs handles both naive and timezone-aware bounds without TypeError."""
    from backend.archive_manager import get_relevant_archive_dbs
    import backend.archive_manager as am

    arc_dir = tmp_path / "archives"
    arc_dir.mkdir()
    month_dir = arc_dir / "2026_10"
    month_dir.mkdir()
    (month_dir / "events_2026_10.db").touch()

    monkeypatch.setattr(am, "get_archive_dir", lambda: arc_dir)

    # Test with offset-naive datetimes (previously crashed with TypeError)
    naive_start = datetime(2026, 11, 1, 20, 30, 0)
    naive_end = datetime(2026, 11, 2, 20, 29, 59)
    res_naive = get_relevant_archive_dbs(naive_start, naive_end)
    assert isinstance(res_naive, list)

    # Test with offset-aware datetimes covering the archive month
    aware_start = datetime(2026, 10, 15, 0, 0, 0, tzinfo=timezone.utc)
    aware_end = datetime(2026, 10, 20, 0, 0, 0, tzinfo=timezone.utc)
    res_aware = get_relevant_archive_dbs(aware_start, aware_end)
    assert len(res_aware) == 1
    assert res_aware[0][0] == "2026_10"
