"""
FaceTrack Reporting & Export Utilities.

Provides high-performance Excel (.xlsx) and CSV export generators for:
- Live Duty & Shift Attendance Rosters
- Historical Detection & Alert Event Logs

Features:
- Dual Jalali (Solar Hijri / Shamsi) and Gregorian timestamps
- Automatic RTL (Right-to-Left) Excel worksheet configuration for Persian layout
- Professional glassmorphism-inspired dark navy styling for Excel tables
- UTF-8-SIG (with BOM) for 100% clean Persian text display in Microsoft Excel & CSV viewers
"""

import csv
import io
from datetime import datetime, timezone
from typing import Optional, Any, Sequence

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from backend.schemas import PersonDutyStatus


# ── Calendar Conversion (Gregorian -> Jalali / Solar Hijri) ───────────

def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
    """Accurately convert Gregorian date to Jalali (Solar Hijri / Shamsi) date."""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    if gy > 1600:
        jy = 979
        gy -= 1600
    else:
        jy = 0
        gy -= 621
    gy2 = gy if gm > 2 else gy - 1
    days = 365 * gy + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) - 80 + gd + g_d_m[gm - 1]
    jy += 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm = 1 + (days // 31)
        jd = 1 + (days % 31)
    else:
        jm = 7 + ((days - 186) // 30)
        jd = 1 + ((days - 186) % 30)
    return jy, jm, jd


def format_jalali_date(dt: Optional[datetime]) -> str:
    """Format datetime into Shamsi date string YYYY/MM/DD."""
    if not dt:
        return "—"
    if dt.tzinfo is not None:
        dt = dt.astimezone()
    jy, jm, jd = gregorian_to_jalali(dt.year, dt.month, dt.day)
    return f"{jy:04d}/{jm:02d}/{jd:02d}"


def format_jalali_datetime(dt: Optional[datetime]) -> str:
    """Format datetime into Shamsi date & time string YYYY/MM/DD HH:MM:SS."""
    if not dt:
        return "—"
    if dt.tzinfo is not None:
        dt = dt.astimezone()
    jy, jm, jd = gregorian_to_jalali(dt.year, dt.month, dt.day)
    return f"{jy:04d}/{jm:02d}/{jd:02d} {dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}"


# ── Localized Status Mappings ─────────────────────────────────────────

STATUS_LABELS_FA = {
    "present": "حاضر در ایستگاه (Present)",
    "absent": "غایب / ترک ایستگاه (Absent)",
    "off_duty": "خارج از شیفت (Off Duty)",
    "camera_offline": "قطعی ارتباط دوربین (Camera Offline)",
    "on_break": "زمان استراحت (On Break)",
}

STATUS_COLORS_XLSX = {
    "present": {"fill": "DCFCE7", "font": "15803D"},        # Emerald green
    "absent": {"fill": "FEE2E2", "font": "B91C1C"},         # Rose red
    "camera_offline": {"fill": "FEF3C7", "font": "B45309"}, # Amber yellow
    "on_break": {"fill": "DBEAFE", "font": "1D4ED8"},       # Blue
    "off_duty": {"fill": "F1F5F9", "font": "475569"},       # Slate gray
}

ALERT_TYPE_LABELS_FA = {
    "normal": "عادی (Normal)",
    "out_of_zone": "خروج از ایستگاه (Out of Zone)",
    "unauthorized_entry": "ورود غیرمجاز (Unauthorized)",
    "absence_timeout": "هشدار طولانی شدن غیبت (Absence Alert)",
    "camera_disconnected": "قطع ارتباط دوربین (Camera Disconnected)",
}

DAY_NAMES_FA = {
    "Sat": "شنبه",
    "Sun": "یکشنبه",
    "Mon": "دوشنبه",
    "Tue": "سه‌شنبه",
    "Wed": "چهارشنبه",
    "Thu": "پنجشنبه",
    "Fri": "جمعه",
}


# ── Styles for Excel ──────────────────────────────────────────────────

FONT_TITLE = Font(name="Tahoma", size=13, bold=True, color="FFFFFF")
FONT_META = Font(name="Tahoma", size=9, bold=False, color="CBD5E1")
FONT_HEADER = Font(name="Tahoma", size=10, bold=True, color="FFFFFF")
FONT_DATA = Font(name="Tahoma", size=9, bold=False, color="1E293B")
FONT_DATA_BOLD = Font(name="Tahoma", size=9, bold=True, color="1E293B")

FILL_TITLE = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
FILL_HEADER = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
FILL_ZEBRA_EVEN = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
FILL_ZEBRA_ODD = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
FILL_KPI_HEADER = PatternFill(start_color="334155", end_color="334155", fill_type="solid")

ALIGN_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
ALIGN_RIGHT = Alignment(horizontal="right", vertical="center", wrap_text=True)
ALIGN_LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)

THIN_BORDER_SIDE = Side(border_style="thin", color="E2E8F0")
BORDER_CELL = Border(
    left=THIN_BORDER_SIDE,
    right=THIN_BORDER_SIDE,
    top=THIN_BORDER_SIDE,
    bottom=THIN_BORDER_SIDE,
)


def _autofit_columns(ws, min_width=12, max_width=50):
    """Automatically adjust column widths to fit content nicely with margins."""
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.value is not None:
                lines = str(cell.value).split("\n")
                for line in lines:
                    # Persian/Arabic characters take slightly more space
                    line_len = len(line)
                    if any(ord(c) > 127 for c in line):
                        line_len = int(line_len * 1.25)
                    if line_len > max_len:
                        max_len = line_len
        ws.column_dimensions[col_letter].width = max(min_width, min(max_len + 4, max_width))


# ── Duty Roster Export (Excel & CSV) ──────────────────────────────────

def generate_duty_roster_xlsx(
    roster: Sequence[PersonDutyStatus],
    report_date: Optional[datetime] = None,
) -> bytes:
    """Generate a styled Excel (.xlsx) file for the Duty Roster with RTL layout."""
    if report_date is None:
        report_date = datetime.now()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "گزارش حضور شیفت"
    ws.sheet_view.rightToLeft = True

    # 1. Title Banner
    shamsi_now_str = format_jalali_datetime(report_date)
    gregorian_now_str = report_date.strftime("%Y-%m-%d %H:%M:%S")

    ws.merge_cells("A1:N1")
    title_cell = ws["A1"]
    title_cell.value = "🎯 سامانه پایش هوشمند FaceTrack — گزارش جامع وضعیت شیفت و حضور پرسنل"
    title_cell.font = FONT_TITLE
    title_cell.fill = FILL_TITLE
    title_cell.alignment = ALIGN_CENTER
    ws.row_dimensions[1].height = 36

    ws.merge_cells("A2:N2")
    meta_cell = ws["A2"]
    meta_cell.value = f"تاریخ تهیه گزارش: {shamsi_now_str} (شمسی)  |  {gregorian_now_str} (میلادی)  |  تعداد پرسنل شیفت: {len(roster)}"
    meta_cell.font = FONT_META
    meta_cell.fill = FILL_TITLE
    meta_cell.alignment = ALIGN_CENTER
    ws.row_dimensions[2].height = 22

    # 2. KPI Summary Bar (Row 4)
    total_staff = len(roster)
    total_present = sum(1 for r in roster if getattr(r, "status", "") == "present")
    total_absent = sum(1 for r in roster if getattr(r, "status", "") == "absent")
    total_break = sum(1 for r in roster if getattr(r, "status", "") == "on_break")
    compliance_values = [
        float(getattr(r, "shift_compliance_pct", getattr(r, "compliance_percentage", 100.0)) or 0.0)
        for r in roster
    ]
    avg_compliance = round(sum(compliance_values) / total_staff, 1) if total_staff > 0 else 100.0

    kpi_headers = ["تعداد کل پرسنل", "حاضر در ایستگاه", "غایب / نامنظم", "زمان استراحت", "میانگین انطباق شیفت"]
    kpi_values = [str(total_staff), str(total_present), str(total_absent), str(total_break), f"{avg_compliance}%"]

    ws.append([])  # Row 3 empty
    ws.row_dimensions[3].height = 10

    # Write KPI card rows
    for c_idx, (kh, kv) in enumerate(zip(kpi_headers, kpi_values), start=2):
        cell_h = ws.cell(row=4, column=c_idx, value=kh)
        cell_h.font = Font(name="Tahoma", size=9, bold=True, color="94A3B8")
        cell_h.fill = FILL_KPI_HEADER
        cell_h.alignment = ALIGN_CENTER
        cell_h.border = BORDER_CELL

        cell_v = ws.cell(row=5, column=c_idx, value=kv)
        cell_v.font = Font(name="Tahoma", size=12, bold=True, color="FFFFFF")
        cell_v.fill = FILL_TITLE
        cell_v.alignment = ALIGN_CENTER
        cell_v.border = BORDER_CELL
    ws.row_dimensions[4].height = 20
    ws.row_dimensions[5].height = 26

    ws.append([])  # Row 6 empty
    ws.row_dimensions[6].height = 12

    # 3. Main Data Table Headers (Row 7)
    headers = [
        "ردیف",
        "نام پرسنل",
        "سمت / نقش",
        "ایستگاه / منطقه",
        "دوربین مربوطه",
        "بازه شیفت",
        "طول شیفت (ساعت)",
        "وضعیت شیفت",
        "مدت حضور",
        "مجموع غیبت",
        "درصد انطباق",
        "تعداد غیبت",
        "جزئیات بازه‌های زمانی غیبت",
        "روزهای فعال شیفت",
    ]
    ws.append(headers)
    header_row_idx = 7
    ws.row_dimensions[header_row_idx].height = 28
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=header_row_idx, column=col_idx)
        c.font = FONT_HEADER
        c.fill = FILL_HEADER
        c.alignment = ALIGN_CENTER
        c.border = BORDER_CELL

    # 4. Data Rows
    for idx, r in enumerate(roster, start=1):
        row_num = header_row_idx + idx
        ws.row_dimensions[row_num].height = 24
        fill_zebra = FILL_ZEBRA_EVEN if idx % 2 == 0 else FILL_ZEBRA_ODD

        status_key = getattr(r, "status", "off_duty")
        status_text = STATUS_LABELS_FA.get(status_key, status_key)
        style_info = STATUS_COLORS_XLSX.get(status_key, STATUS_COLORS_XLSX["off_duty"])
        status_fill = PatternFill(start_color=style_info["fill"], end_color=style_info["fill"], fill_type="solid")
        status_font = Font(name="Tahoma", size=9, bold=True, color=style_info["font"])

        # Format presence & absence
        pres_str = getattr(r, "shift_presence_str", "")
        if not pres_str:
            pres_m = getattr(r, "shift_presence_minutes", 0)
            pres_str = f"{pres_m // 60}h {pres_m % 60}m" if pres_m >= 60 else f"{pres_m}m"

        abs_str = getattr(r, "shift_absence_str", "")
        if not abs_str:
            abs_m = getattr(r, "shift_absence_minutes", 0)
            abs_str = f"{abs_m // 60}h {abs_m % 60}m" if abs_m >= 60 else f"{abs_m}m"

        compliance_pct = getattr(r, "shift_compliance_pct", getattr(r, "compliance_percentage", 100.0))
        absence_cnt = getattr(r, "absence_count", getattr(r, "absence_incident_count", 0))

        # Format intervals
        intervals_summary = "—"
        intervals = getattr(r, "absence_intervals", [])
        if intervals:
            parts = []
            for it in intervals:
                type_name = "عدم حضور"
                it_type = getattr(it, "interval_type", "") if hasattr(it, "interval_type") else it.get("interval_type", "")
                it_start = getattr(it, "start_time", "") if hasattr(it, "start_time") else it.get("start_time", "")
                it_end = getattr(it, "end_time", "") if hasattr(it, "end_time") else it.get("end_time", "")
                it_dur = getattr(it, "duration_str", "") if hasattr(it, "duration_str") else it.get("duration_str", "")
                if it_type == "late_arrival":
                    type_name = "تأخیر ورود"
                elif it_type == "unseen":
                    type_name = "عدم حضور کامل"
                elif it_type == "current":
                    type_name = "غیبت جاری"
                parts.append(f"{it_start}-{it_end} ({type_name}: {it_dur})")
            intervals_summary = " | ".join(parts)

        # Format active days
        act_days = getattr(r, "active_days", []) or []
        days_str = ", ".join(DAY_NAMES_FA.get(d, d) for d in act_days)

        shift_w_str = getattr(r, "shift_window_str", "")
        if getattr(r, "is_overnight", False):
            shift_w_str = f"🌙 {shift_w_str} (شیفت شب)"
        s_name = getattr(r, "shift_name", None)
        if s_name:
            shift_w_str = f"{s_name} ({shift_w_str})"

        row_values = [
            idx,
            getattr(r, "person_name", f"Person #{getattr(r, 'person_id', '')}"),
            getattr(r, "person_role", "") or "—",
            getattr(r, "zone_name", ""),
            getattr(r, "camera_name", ""),
            shift_w_str,
            getattr(r, "shift_duration_hours", 8.0),
            status_text,
            pres_str,
            abs_str,
            f"{compliance_pct}%",
            absence_cnt,
            intervals_summary,
            days_str,
        ]

        for col_idx, val in enumerate(row_values, start=1):
            cell = ws.cell(row=row_num, column=col_idx, value=val)
            cell.border = BORDER_CELL
            if col_idx == 8:  # Status column
                cell.fill = status_fill
                cell.font = status_font
                cell.alignment = ALIGN_CENTER
            elif col_idx in (1, 6, 7, 9, 10, 11, 12):
                cell.fill = fill_zebra
                cell.font = FONT_DATA_BOLD if col_idx == 11 else FONT_DATA
                cell.alignment = ALIGN_CENTER
            elif col_idx in (2, 3, 4, 5):
                cell.fill = fill_zebra
                cell.font = FONT_DATA
                cell.alignment = ALIGN_RIGHT
            else:
                cell.fill = fill_zebra
                cell.font = FONT_DATA
                cell.alignment = ALIGN_LEFT

    _autofit_columns(ws, min_width=10, max_width=45)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def generate_duty_roster_csv(
    roster: Sequence[PersonDutyStatus],
    report_date: Optional[datetime] = None,
) -> bytes:
    """Generate a clean CSV file with UTF-8 BOM encoding for Persian Excel compatibility."""
    if report_date is None:
        report_date = datetime.now()

    shamsi_date = format_jalali_datetime(report_date)

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    # Header comments / Title
    writer.writerow(["# سامانه تشخیص چهره FaceTrack - گزارش شیفت و حضور پرسنل"])
    writer.writerow([f"# تاریخ تهیه گزارش: {shamsi_date}"])
    writer.writerow([])

    # Column Headers
    writer.writerow([
        "ردیف",
        "نام پرسنل",
        "سمت",
        "ایستگاه",
        "دوربین",
        "بازه شیفت",
        "طول شیفت (ساعت)",
        "وضعیت شیفت",
        "حضور در ایستگاه",
        "مدت حضور",
        "مجموع غیبت",
        "درصد انطباق",
        "تعداد غیبت",
        "جزئیات بازه‌های غیبت",
        "روزهای فعال",
    ])

    for idx, r in enumerate(roster, start=1):
        status_key = getattr(r, "status", "off_duty")
        status_text = STATUS_LABELS_FA.get(status_key, status_key)
        pres_str = getattr(r, "shift_presence_str", "")
        if not pres_str:
            pres_m = getattr(r, "shift_presence_minutes", 0)
            pres_str = f"{pres_m // 60}h {pres_m % 60}m" if pres_m >= 60 else f"{pres_m}m"

        abs_str = getattr(r, "shift_absence_str", "")
        if not abs_str:
            abs_m = getattr(r, "shift_absence_minutes", 0)
            abs_str = f"{abs_m // 60}h {abs_m % 60}m" if abs_m >= 60 else f"{abs_m}m"

        compliance_pct = getattr(r, "shift_compliance_pct", getattr(r, "compliance_percentage", 100.0))
        absence_cnt = getattr(r, "absence_count", getattr(r, "absence_incident_count", 0))

        intervals_summary = "—"
        intervals = getattr(r, "absence_intervals", [])
        if intervals:
            parts = []
            for it in intervals:
                it_start = getattr(it, "start_time", "") if hasattr(it, "start_time") else it.get("start_time", "")
                it_end = getattr(it, "end_time", "") if hasattr(it, "end_time") else it.get("end_time", "")
                it_dur = getattr(it, "duration_str", "") if hasattr(it, "duration_str") else it.get("duration_str", "")
                parts.append(f"{it_start}-{it_end} ({it_dur})")
            intervals_summary = " | ".join(parts)

        act_days = getattr(r, "active_days", []) or []
        days_str = ", ".join(DAY_NAMES_FA.get(d, d) for d in act_days)
        is_in_zone = bool(getattr(r, "is_in_zone", False))

        shift_w_str = getattr(r, "shift_window_str", "")
        if getattr(r, "is_overnight", False):
            shift_w_str = f"🌙 {shift_w_str} (شیفت شب)"
        s_name = getattr(r, "shift_name", None)
        if s_name:
            shift_w_str = f"{s_name} ({shift_w_str})"

        writer.writerow([
            idx,
            getattr(r, "person_name", f"Person #{getattr(r, 'person_id', '')}"),
            getattr(r, "person_role", "") or "",
            getattr(r, "zone_name", ""),
            getattr(r, "camera_name", ""),
            shift_w_str,
            getattr(r, "shift_duration_hours", 8.0),
            status_text,
            "بله" if is_in_zone else "خیر",
            pres_str,
            abs_str,
            f"{compliance_pct}%",
            absence_cnt,
            intervals_summary,
            days_str,
        ])

    csv_text = output.getvalue()
    # Prepend UTF-8 BOM so Excel on Windows recognizes Arabic/Persian UTF-8
    return b"\xef\xbb\xbf" + csv_text.encode("utf-8")


# ── Events Log Export (Excel & CSV) ───────────────────────────────────

def generate_events_xlsx(
    events: Sequence[dict[str, Any]],
    report_date: Optional[datetime] = None,
    filter_summary: Optional[str] = None,
) -> bytes:
    """Generate a styled Excel (.xlsx) file for detection and security alert logs."""
    if report_date is None:
        report_date = datetime.now()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "گزارش رویدادها"
    ws.sheet_view.rightToLeft = True

    shamsi_now_str = format_jalali_datetime(report_date)
    gregorian_now_str = report_date.strftime("%Y-%m-%d %H:%M:%S")

    # 1. Title Banner
    ws.merge_cells("A1:K1")
    title_cell = ws["A1"]
    title_cell.value = "🎯 سامانه پایش تصویری FaceTrack — گزارش لاگ رویدادها و هشدارهای امنیتی"
    title_cell.font = FONT_TITLE
    title_cell.fill = FILL_TITLE
    title_cell.alignment = ALIGN_CENTER
    ws.row_dimensions[1].height = 36

    ws.merge_cells("A2:K2")
    meta_cell = ws["A2"]
    filter_text = f"  |  فیلتر: {filter_summary}" if filter_summary else ""
    meta_cell.value = f"تاریخ تهیه گزارش: {shamsi_now_str} (شمسی)  |  تعداد رکوردها: {len(events)}{filter_text}"
    meta_cell.font = FONT_META
    meta_cell.fill = FILL_TITLE
    meta_cell.alignment = ALIGN_CENTER
    ws.row_dimensions[2].height = 22

    ws.append([])  # Row 3 empty
    ws.row_dimensions[3].height = 10

    # 2. Column Headers (Row 4)
    headers = [
        "ردیف",
        "شناسه",
        "تاریخ شمسی",
        "زمان",
        "زمان میلادی (UTC)",
        "نام فرد شناسایی‌شده",
        "نوع هویت",
        "درصد اطمینان",
        "نام دوربین",
        "منطقه / ایستگاه",
        "نوع رویداد / هشدار",
    ]
    ws.append(headers)
    header_row_idx = 4
    ws.row_dimensions[header_row_idx].height = 28

    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=header_row_idx, column=col_idx)
        c.font = FONT_HEADER
        c.fill = FILL_HEADER
        c.alignment = ALIGN_CENTER
        c.border = BORDER_CELL

    # 3. Data Rows
    for idx, ev in enumerate(events, start=1):
        row_num = header_row_idx + idx
        ws.row_dimensions[row_num].height = 22
        fill_zebra = FILL_ZEBRA_EVEN if idx % 2 == 0 else FILL_ZEBRA_ODD

        ts: Optional[datetime] = ev.get("timestamp")
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                ts = None

        shamsi_date = format_jalali_date(ts)
        shamsi_time = ts.astimezone().strftime("%H:%M:%S") if ts else "—"
        gregorian_iso = ts.strftime("%Y-%m-%d %H:%M:%S") if ts else "—"

        is_known = bool(ev.get("is_known", False))
        identity_type = "پرسنل مجاز (Known)" if is_known else "فرد ناشناس (Unknown)"
        raw_alert = str(ev.get("alert_type") or "normal")
        alert_label = ALERT_TYPE_LABELS_FA.get(raw_alert, raw_alert)

        conf_score = float(ev.get("confidence_score") or 0.0)
        if raw_alert in ("absence_timeout", "camera_disconnected"):
            conf_str = "—"
        else:
            conf_str = f"{round(conf_score * 100, 1)}%" if conf_score > 0 else "—"

        row_values = [
            idx,
            ev.get("id"),
            shamsi_date,
            shamsi_time,
            gregorian_iso,
            ev.get("person_name") or "Unknown",
            identity_type,
            conf_str,
            ev.get("camera_name") or "—",
            ev.get("zone_name") or "—",
            alert_label,
        ]

        for col_idx, val in enumerate(row_values, start=1):
            cell = ws.cell(row=row_num, column=col_idx, value=val)
            cell.border = BORDER_CELL
            cell.fill = fill_zebra
            cell.font = FONT_DATA

            if col_idx in (1, 2, 3, 4, 5, 8):
                cell.alignment = ALIGN_CENTER
            elif col_idx == 7:  # Identity
                cell.alignment = ALIGN_CENTER
                cell.font = Font(
                    name="Tahoma",
                    size=9,
                    bold=True,
                    color="15803D" if is_known else "B91C1C",
                )
            elif col_idx == 11 and raw_alert != "normal":  # Alert
                cell.alignment = ALIGN_CENTER
                cell.fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
                cell.font = Font(name="Tahoma", size=9, bold=True, color="B91C1C")
            else:
                cell.alignment = ALIGN_RIGHT

    _autofit_columns(ws, min_width=10, max_width=40)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def generate_events_csv(
    events: Sequence[dict[str, Any]],
    report_date: Optional[datetime] = None,
    filter_summary: Optional[str] = None,
) -> bytes:
    """Generate a clean CSV file with UTF-8 BOM encoding for events logs."""
    if report_date is None:
        report_date = datetime.now()

    shamsi_date = format_jalali_datetime(report_date)

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    writer.writerow(["# سامانه تشخیص چهره FaceTrack - گزارش رویدادها و هشدارها"])
    writer.writerow([f"# تاریخ تهیه گزارش: {shamsi_date}"])
    if filter_summary:
        writer.writerow([f"# فیلترها: {filter_summary}"])
    writer.writerow([])

    writer.writerow([
        "ردیف",
        "شناسه رویداد",
        "تاریخ شمسی",
        "زمان",
        "زمان میلادی (UTC)",
        "نام فرد",
        "نوع هویت",
        "درصد اطمینان",
        "نام دوربین",
        "مکان دوربین",
        "منطقه / ایستگاه",
        "نوع رویداد / هشدار",
    ])

    for idx, ev in enumerate(events, start=1):
        ts: Optional[datetime] = ev.get("timestamp")
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                ts = None

        shamsi_date = format_jalali_date(ts)
        shamsi_time = ts.astimezone().strftime("%H:%M:%S") if ts else "—"
        gregorian_iso = ts.strftime("%Y-%m-%d %H:%M:%S") if ts else "—"

        is_known = bool(ev.get("is_known", False))
        identity_type = "شناخته شده" if is_known else "ناشناس"
        raw_alert = str(ev.get("alert_type") or "normal")
        alert_label = ALERT_TYPE_LABELS_FA.get(raw_alert, raw_alert)

        conf_score = float(ev.get("confidence_score") or 0.0)
        if raw_alert in ("absence_timeout", "camera_disconnected"):
            conf_str = "—"
        else:
            conf_str = f"{round(conf_score * 100, 1)}%" if conf_score > 0 else "—"

        writer.writerow([
            idx,
            ev.get("id"),
            shamsi_date,
            shamsi_time,
            gregorian_iso,
            ev.get("person_name") or "Unknown",
            identity_type,
            conf_str,
            ev.get("camera_name") or "",
            ev.get("camera_location") or "",
            ev.get("zone_name") or "",
            alert_label,
        ])

    csv_text = output.getvalue()
    return b"\xef\xbb\xbf" + csv_text.encode("utf-8")


# ── Person Analytics & Attendance Export (Excel & CSV) ────────────────

def generate_person_analytics_xlsx(
    analytics: dict[str, Any],
    person_name: str,
    role: str = "",
    section: str = "",
    start_date_str: str = "",
    end_date_str: str = "",
    report_date: Optional[datetime] = None,
) -> bytes:
    """
    Generate a high-grade, executive Excel (.xlsx) report for an individual
    person's shift attendance and analytics across a selected time frame.
    Strictly Zero-Photo / Privacy-safe with Jalali timestamps and RTL layout.
    """
    if report_date is None:
        report_date = datetime.now()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "گزارش عملکرد پرسنل"
    ws.sheet_view.rightToLeft = True

    comp = analytics.get("shift_compliance") or {}
    alerts = analytics.get("alerts") or {}
    cams = analytics.get("camera_distribution") or []
    daily_list = analytics.get("daily_activity_last_14_days") or analytics.get("daily_activity") or []

    # Calculate Shamsi dates for the requested period
    def _parse_d_to_shamsi(d_str: str) -> str:
        if not d_str:
            return "—"
        try:
            dt = datetime.strptime(d_str, "%Y-%m-%d")
            return format_jalali_date(dt)
        except Exception:
            return d_str

    start_shamsi = _parse_d_to_shamsi(start_date_str)
    end_shamsi = _parse_d_to_shamsi(end_date_str)
    shamsi_now_str = format_jalali_datetime(report_date)
    gregorian_now_str = report_date.strftime("%Y-%m-%d %H:%M:%S")

    # 1. Header Banner
    ws.merge_cells("A1:P1")
    title_cell = ws["A1"]
    title_cell.value = "🎯 سامانه پایش هوشمند FaceTrack — گزارش تحلیلی عملکرد و انضباط پرسنل"
    title_cell.font = FONT_TITLE
    title_cell.fill = FILL_TITLE
    title_cell.alignment = ALIGN_CENTER
    ws.row_dimensions[1].height = 36

    ws.merge_cells("A2:P2")
    meta_cell = ws["A2"]
    meta_cell.value = (
        f"پرسنل: {person_name}  |  سمت: {role or 'پرسنل'}  |  بخش: {section or 'عمومی'}  |  "
        f"بازه گزارش: {start_shamsi} تا {end_shamsi} ({len(daily_list)} روز)  |  "
        f"تاریخ صدور: {shamsi_now_str} (شمسی)"
    )
    meta_cell.font = FONT_META
    meta_cell.fill = FILL_TITLE
    meta_cell.alignment = ALIGN_CENTER
    ws.row_dimensions[2].height = 22

    ws.append([])  # Row 3 empty
    ws.row_dimensions[3].height = 10

    # 2. Executive KPI Cards Bar (Rows 4-5)
    comp_rate = comp.get("compliance_rate", 100.0)
    sched_days = comp.get("scheduled_shift_days", 0)
    pres_days = comp.get("present_shift_days", 0)
    abs_days = comp.get("absent_shift_days", 0)
    tot_abs_str = comp.get("total_absence_hours_str") or "۰ دقیقه"
    tot_delay_m = comp.get("total_delay_minutes", 0)
    tot_early_m = comp.get("total_early_minutes", 0)
    tot_alerts = alerts.get("total_alerts", 0)

    # Compute total presence time across analyzed days
    tot_pres_secs = sum((d.get("estimated_duration_seconds") or 0) for d in daily_list)
    ph = tot_pres_secs // 3600
    pm = (tot_pres_secs % 3600) // 60
    tot_pres_str = f"{ph} ساعت و {pm} دقیقه" if ph > 0 else f"{pm} دقیقه"

    kpi_cards = [
        ("نرخ انطباق شیفت", f"{comp_rate}%"),
        ("مجموع ساعات حضور", tot_pres_str),
        ("مجموع زمان غیبت", str(tot_abs_str)),
        ("روزهای حاضر / برنامه", f"{pres_days} از {sched_days} روز"),
        ("روزهای غیبت کامل", f"{abs_days} روز"),
        ("مجموع تأخیر ورود", f"{tot_delay_m} دقیقه"),
        ("مجموع تعجیل خروج", f"{tot_early_m} دقیقه"),
        ("هشدارهای امنیتی", f"{tot_alerts} مورد"),
    ]

    for c_idx, (kh, kv) in enumerate(kpi_cards, start=1):
        # 2 columns per KPI to spread evenly across 16 columns
        col_start = (c_idx - 1) * 2 + 1
        col_end = col_start + 1
        ws.merge_cells(start_row=4, start_column=col_start, end_row=4, end_column=col_end)
        ws.merge_cells(start_row=5, start_column=col_start, end_row=5, end_column=col_end)

        cell_h = ws.cell(row=4, column=col_start, value=kh)
        cell_h.font = Font(name="Tahoma", size=9, bold=True, color="94A3B8")
        cell_h.fill = FILL_KPI_HEADER
        cell_h.alignment = ALIGN_CENTER
        cell_h.border = BORDER_CELL

        cell_v = ws.cell(row=5, column=col_start, value=kv)
        cell_v.font = Font(name="Tahoma", size=11, bold=True, color="FFFFFF")
        cell_v.fill = FILL_TITLE
        cell_v.alignment = ALIGN_CENTER
        cell_v.border = BORDER_CELL

    ws.row_dimensions[4].height = 20
    ws.row_dimensions[5].height = 26

    ws.append([])  # Row 6 empty
    ws.row_dimensions[6].height = 12

    # 3. Workstation / Camera Activity Distribution Section
    curr_row = 7
    if cams:
        ws.merge_cells(f"A{curr_row}:D{curr_row}")
        c_sec_cell = ws[f"A{curr_row}"]
        c_sec_cell.value = "📍 توزیع فعالیت در ایستگاه‌ها و دوربین‌ها"
        c_sec_cell.font = Font(name="Tahoma", size=10, bold=True, color="1E293B")
        ws.row_dimensions[curr_row].height = 24
        curr_row += 1

        cam_headers = ["ردیف", "نام دوربین / ایستگاه", "تعداد تردد ثبت‌شده", "درصد فعالیت (%)"]
        for ci, ch in enumerate(cam_headers, start=1):
            c = ws.cell(row=curr_row, column=ci, value=ch)
            c.font = Font(name="Tahoma", size=9, bold=True, color="FFFFFF")
            c.fill = FILL_HEADER
            c.alignment = ALIGN_CENTER
            c.border = BORDER_CELL
        ws.row_dimensions[curr_row].height = 24
        curr_row += 1

        for idx, cam in enumerate(cams, start=1):
            row_fill = FILL_ZEBRA_EVEN if idx % 2 == 0 else FILL_ZEBRA_ODD
            ws.cell(row=curr_row, column=1, value=idx).alignment = ALIGN_CENTER
            ws.cell(row=curr_row, column=2, value=cam.get("camera_name", "—")).alignment = ALIGN_RIGHT
            ws.cell(row=curr_row, column=3, value=cam.get("count", 0)).alignment = ALIGN_CENTER
            ws.cell(row=curr_row, column=4, value=f"{cam.get('percentage', 0)}%").alignment = ALIGN_CENTER

            for ci in range(1, 5):
                cell = ws.cell(row=curr_row, column=ci)
                cell.font = FONT_DATA
                cell.fill = row_fill
                cell.border = BORDER_CELL
            ws.row_dimensions[curr_row].height = 20
            curr_row += 1

        ws.cell(row=curr_row, column=1)  # spacing
        ws.row_dimensions[curr_row].height = 12
        curr_row += 1

    # 4. Daily Attendance & Compliance Detail Table
    ws.merge_cells(f"A{curr_row}:P{curr_row}")
    tbl_title = ws[f"A{curr_row}"]
    tbl_title.value = "📋 ریز سوابق حضور، تردد و وضعیت انطباق شیفت روزانه"
    tbl_title.font = Font(name="Tahoma", size=10, bold=True, color="1E293B")
    ws.row_dimensions[curr_row].height = 24
    curr_row += 1

    detail_headers = [
        "ردیف",
        "تاریخ شمسی",
        "تاریخ میلادی",
        "روز هفته",
        "بازه شیفت",
        "وضعیت روز",
        "اولین ورود",
        "آخرین خروج",
        "مدت حضور",
        "مدت غیبت",
        "تأخیر (دقیقه)",
        "تعجیل (دقیقه)",
        "نوبت‌های ترک",
        "ایستگاه اصلی",
        "تعداد ثبت",
        "هشدارها",
    ]
    for ci, ch in enumerate(detail_headers, start=1):
        c = ws.cell(row=curr_row, column=ci, value=ch)
        c.font = FONT_HEADER
        c.fill = FILL_HEADER
        c.alignment = ALIGN_CENTER
        c.border = BORDER_CELL
    ws.row_dimensions[curr_row].height = 28
    curr_row += 1

    status_labels_fa = {
        "on_time": "به‌موقع (حاضر)",
        "late": "با تأخیر (حاضر)",
        "absent": "غایب از شیفت",
        "rest_day": "روز استراحت",
        "camera_offline": "قطعی دوربین",
        "off_schedule": "حضور خارج شیفت",
    }

    for idx, day in enumerate(daily_list, start=1):
        fill_zebra = FILL_ZEBRA_EVEN if idx % 2 == 0 else FILL_ZEBRA_ODD
        d_str = day.get("date", "")
        shamsi_date = _parse_d_to_shamsi(d_str)
        day_raw = day.get("day_name", "")
        day_fa = DAY_NAMES_FA.get(day_raw, day_raw)

        is_sched = day.get("is_scheduled_shift_day", False)
        s_start = day.get("shift_start_time")
        s_end = day.get("shift_end_time")
        shift_str = f"{s_start} - {s_end}" if (s_start and s_end) else ("روز استراحت" if not is_sched else "تعریف نشده")

        arr_stat = day.get("arrival_status", "")
        stat_label = status_labels_fa.get(arr_stat, arr_stat or ("حاضر" if day.get("detections_count", 0) > 0 else "—"))

        f_seen = day.get("first_seen_time") or "—"
        l_seen = day.get("last_seen_time") or "—"
        dur_str = day.get("estimated_duration_str") or "—"
        abs_str = day.get("absence_from_shift_str") or "۰m"
        del_m = day.get("delay_minutes", 0)
        early_m = day.get("early_leave_minutes", 0)
        abs_cnt = day.get("absence_count", 0)
        top_cam = day.get("primary_camera") or "—"
        det_cnt = day.get("detections_count", 0)
        alt_cnt = day.get("alerts_count", 0)

        row_vals = [
            idx,
            shamsi_date,
            d_str,
            day_fa,
            shift_str,
            stat_label,
            f_seen,
            l_seen,
            dur_str,
            abs_str,
            del_m if del_m > 0 else "—",
            early_m if early_m > 0 else "—",
            abs_cnt if abs_cnt > 0 else "—",
            top_cam,
            det_cnt,
            alt_cnt if alt_cnt > 0 else "—",
        ]

        for ci, val in enumerate(row_vals, start=1):
            cell = ws.cell(row=curr_row, column=ci, value=val)
            cell.border = BORDER_CELL
            cell.fill = fill_zebra
            cell.font = FONT_DATA

            if ci in (1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 15, 16):
                cell.alignment = ALIGN_CENTER
            elif ci == 6:  # Status column highlighting
                cell.alignment = ALIGN_CENTER
                if arr_stat in ("on_time", "normal"):
                    cell.fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
                    cell.font = Font(name="Tahoma", size=9, bold=True, color="15803D")
                elif arr_stat in ("late",):
                    cell.fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
                    cell.font = Font(name="Tahoma", size=9, bold=True, color="B45309")
                elif arr_stat in ("absent",):
                    cell.fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
                    cell.font = Font(name="Tahoma", size=9, bold=True, color="B91C1C")
                else:
                    cell.font = Font(name="Tahoma", size=9, bold=True, color="475569")
            else:
                cell.alignment = ALIGN_RIGHT

        ws.row_dimensions[curr_row].height = 22
        curr_row += 1

    _autofit_columns(ws, min_width=10, max_width=40)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def generate_person_analytics_csv(
    analytics: dict[str, Any],
    person_name: str,
    role: str = "",
    section: str = "",
    start_date_str: str = "",
    end_date_str: str = "",
    report_date: Optional[datetime] = None,
) -> bytes:
    """Generate a clean CSV export for person analytics with UTF-8 BOM encoding."""
    if report_date is None:
        report_date = datetime.now()

    shamsi_date = format_jalali_datetime(report_date)
    comp = analytics.get("shift_compliance") or {}
    alerts = analytics.get("alerts") or {}
    daily_list = analytics.get("daily_activity_last_14_days") or analytics.get("daily_activity") or []

    def _parse_d_to_shamsi(d_str: str) -> str:
        if not d_str:
            return "—"
        try:
            dt = datetime.strptime(d_str, "%Y-%m-%d")
            return format_jalali_date(dt)
        except Exception:
            return d_str

    start_shamsi = _parse_d_to_shamsi(start_date_str)
    end_shamsi = _parse_d_to_shamsi(end_date_str)

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    writer.writerow(["# سامانه تشخیص چهره FaceTrack - گزارش عملکرد و حضور پرسنل"])
    writer.writerow([f"# نام پرسنل: {person_name} | سمت: {role or 'پرسنل'} | بخش: {section or 'عمومی'}"])
    writer.writerow([f"# بازه زمانی گزارش: {start_shamsi} ({start_date_str}) تا {end_shamsi} ({end_date_str})"])
    writer.writerow([f"# تاریخ تولید گزارش: {shamsi_date}"])
    writer.writerow([])

    # KPI summary
    comp_rate = comp.get("compliance_rate", 100.0)
    sched_days = comp.get("scheduled_shift_days", 0)
    pres_days = comp.get("present_shift_days", 0)
    abs_days = comp.get("absent_shift_days", 0)
    tot_abs_str = comp.get("total_absence_hours_str") or "0m"
    tot_delay_m = comp.get("total_delay_minutes", 0)
    tot_early_m = comp.get("total_early_minutes", 0)
    tot_alerts = alerts.get("total_alerts", 0)

    writer.writerow(["# خلاصه شاخص‌های کلیدی عملکرد (KPIs)"])
    writer.writerow(["شاخص", "مقدار"])
    writer.writerow(["نرخ پایبندی به شیفت (انضباط)", f"{comp_rate}%"])
    writer.writerow(["روزهای حاضر شیفت", f"{pres_days} از {sched_days} روز"])
    writer.writerow(["روزهای غیبت شیفت", f"{abs_days} روز"])
    writer.writerow(["مجموع غیبت در بازه", str(tot_abs_str)])
    writer.writerow(["مجموع تأخیر ورود (دقیقه)", tot_delay_m])
    writer.writerow(["مجموع تعجیل خروج (دقیقه)", tot_early_m])
    writer.writerow(["هشدارهای امنیتی", tot_alerts])
    writer.writerow([])

    # Table
    writer.writerow([
        "ردیف",
        "تاریخ شمسی",
        "تاریخ میلادی",
        "روز هفته",
        "بازه شیفت",
        "وضعیت حضور",
        "اولین مشاهده (ورود)",
        "آخرین مشاهده (خروج)",
        "مدت زمان حضور",
        "مدت غیبت از شیفت",
        "میزان تأخیر (دقیقه)",
        "میزان تعجیل خروج (دقیقه)",
        "نوبت‌های ترک ایستگاه",
        "ایستگاه / دوربین اصلی",
        "تعداد دفعات ثبت تردد",
        "تعداد هشدارها",
    ])

    status_labels_fa = {
        "on_time": "به‌موقع (حاضر)",
        "late": "با تأخیر (حاضر)",
        "absent": "غایب از شیفت",
        "rest_day": "روز استراحت",
        "camera_offline": "قطعی دوربین",
        "off_schedule": "حضور خارج شیفت",
    }

    for idx, day in enumerate(daily_list, start=1):
        d_str = day.get("date", "")
        sh_date = _parse_d_to_shamsi(d_str)
        day_raw = day.get("day_name", "")
        day_fa = DAY_NAMES_FA.get(day_raw, day_raw)

        is_sched = day.get("is_scheduled_shift_day", False)
        s_start = day.get("shift_start_time")
        s_end = day.get("shift_end_time")
        shift_str = f"{s_start} - {s_end}" if (s_start and s_end) else ("روز استراحت" if not is_sched else "تعریف نشده")

        arr_stat = day.get("arrival_status", "")
        stat_label = status_labels_fa.get(arr_stat, arr_stat or ("حاضر" if day.get("detections_count", 0) > 0 else "—"))

        writer.writerow([
            idx,
            sh_date,
            d_str,
            day_fa,
            shift_str,
            stat_label,
            day.get("first_seen_time") or "—",
            day.get("last_seen_time") or "—",
            day.get("estimated_duration_str") or "—",
            day.get("absence_from_shift_str") or "0m",
            day.get("delay_minutes", 0),
            day.get("early_leave_minutes", 0),
            day.get("absence_count", 0),
            day.get("primary_camera") or "—",
            day.get("detections_count", 0),
            day.get("alerts_count", 0),
        ])

    csv_text = output.getvalue()
    return b"\xef\xbb\xbf" + csv_text.encode("utf-8")

