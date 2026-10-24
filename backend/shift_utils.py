"""
Shift and timetable utilities for FaceTrack.
Shared across zones router, stream processor, and duty roster reporting.
"""

import json
from datetime import datetime, timezone, timedelta
from typing import Optional, Any


def _to_local_dt(dt: Optional[datetime]) -> datetime:
    """Convert UTC or naive datetime to local timezone datetime (naive representation for direct comparisons)."""
    if dt is None:
        return datetime.now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().replace(tzinfo=None)


def _format_duration(seconds: int) -> str:
    """Format duration in seconds to a human-readable string."""
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    rem_mins = minutes % 60
    return f"{hours}h {rem_mins}m" if rem_mins > 0 else f"{hours}h"


def _parse_list_field(val: Any, default: list) -> list:
    """Safely parse a database field into a Python list."""
    if val is None:
        return default
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    return default


def get_shift_window(
    start_time: Any,
    end_time: Any,
    active_days: Any,
    ref_dt: Optional[datetime] = None,
) -> tuple[bool, datetime, datetime, bool, float, int]:
    """
    Calculate active status and exact local start & end datetimes for a shift,
    with full support for overnight / midnight-crossing shifts.

    Returns:
      (is_active_now, shift_start_dt, shift_end_dt, is_overnight, shift_duration_hours, elapsed_minutes)
    """
    if ref_dt is None:
        ref_dt = datetime.now()

    days_list = _parse_list_field(active_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    start_str = str(start_time).strip() if start_time else "00:00"
    end_str = str(end_time).strip() if end_time else "23:59"

    try:
        sh, sm = map(int, start_str.split(":"))
    except Exception:
        sh, sm = 0, 0
    try:
        eh, em = map(int, end_str.split(":"))
    except Exception:
        eh, em = 23, 59

    start_mins = sh * 60 + sm
    end_mins = eh * 60 + em
    is_overnight = start_mins > end_mins
    ref_hm_mins = ref_dt.hour * 60 + ref_dt.minute

    if not is_overnight:
        # Standard intra-day shift (e.g. 08:00 - 17:00 or 00:00 - 23:59)
        day_name = ref_dt.strftime("%a")
        shift_start = ref_dt.replace(hour=sh, minute=sm, second=0, microsecond=0)
        shift_end = ref_dt.replace(hour=eh, minute=em, second=0, microsecond=0)
        total_duration_hours = max(0.1, round((shift_end - shift_start).total_seconds() / 3600.0, 1))

        is_active = (day_name in days_list) and (shift_start <= ref_dt <= shift_end)
        if is_active:
            elapsed_minutes = max(0, int((ref_dt - shift_start).total_seconds() // 60))
        else:
            elapsed_minutes = 0

        return is_active, shift_start, shift_end, False, total_duration_hours, elapsed_minutes

    else:
        # Cross-midnight overnight shift (e.g. 22:00 - 06:00)
        total_shift_mins = (24 * 60 - start_mins) + end_mins
        total_duration_hours = max(0.1, round(total_shift_mins / 60.0, 1))

        if ref_hm_mins >= start_mins:
            # Shift started today (before midnight) and will end tomorrow morning
            origin_day_name = ref_dt.strftime("%a")
            shift_start = ref_dt.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_end = (ref_dt + timedelta(days=1)).replace(hour=eh, minute=em, second=0, microsecond=0)
            is_active = origin_day_name in days_list
            elapsed_minutes = max(0, int((ref_dt - shift_start).total_seconds() // 60)) if is_active else 0
            return is_active, shift_start, shift_end, True, total_duration_hours, elapsed_minutes

        elif ref_hm_mins <= end_mins:
            # Shift started yesterday (before midnight) and ends today morning
            yesterday = ref_dt - timedelta(days=1)
            origin_day_name = yesterday.strftime("%a")
            shift_start = yesterday.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_end = ref_dt.replace(hour=eh, minute=em, second=0, microsecond=0)
            is_active = origin_day_name in days_list
            elapsed_minutes = max(0, int((ref_dt - shift_start).total_seconds() // 60)) if is_active else 0
            return is_active, shift_start, shift_end, True, total_duration_hours, elapsed_minutes

        else:
            # Outside active shift hours (e.g. 14:00 when shift is 22:00 - 06:00)
            yesterday = ref_dt - timedelta(days=1)
            shift_start = yesterday.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_end = ref_dt.replace(hour=eh, minute=em, second=0, microsecond=0)
            return False, shift_start, shift_end, True, total_duration_hours, 0


def is_time_in_timetable(
    start_time: Any,
    end_time: Any,
    active_days: Any,
    current_dt: Optional[datetime] = None,
) -> bool:
    """Check if the current local time and day falls within a timetable."""
    is_active, _, _, _, _, _ = get_shift_window(start_time, end_time, active_days, current_dt)
    return is_active


def is_time_in_free_time(
    free_times: Any,
    current_dt: Optional[datetime] = None,
) -> tuple[bool, Optional[str]]:
    """Check if current local time falls within any defined free/break time interval (lunch, tea, rest)."""
    parsed_breaks = _parse_list_field(free_times, [])
    if not parsed_breaks:
        return False, None
    if current_dt is None:
        current_dt = datetime.now()
    now_hm_mins = current_dt.hour * 60 + current_dt.minute

    for b in parsed_breaks:
        if not isinstance(b, dict):
            continue
        start_str = str(b.get("start_time") or "00:00")
        end_str = str(b.get("end_time") or "00:00")
        name = str(b.get("name") or "Break")
        try:
            bsh, bsm = map(int, start_str.split(":"))
            beh, bem = map(int, end_str.split(":"))
        except Exception:
            continue
        b_start = bsh * 60 + bsm
        b_end = beh * 60 + bem

        if b_start <= b_end:
            if b_start <= now_hm_mins <= b_end:
                return True, name
        else:
            if now_hm_mins >= b_start or now_hm_mins <= b_end:
                return True, name

    return False, None


def get_interval_free_minutes(
    start_dt: datetime,
    end_dt: datetime,
    free_times: Any,
) -> int:
    """
    Calculate the total minutes between start_dt and end_dt that fall
    within scheduled free times / breaks (lunch, tea, rest).
    """
    parsed_breaks = _parse_list_field(free_times, [])
    if not parsed_breaks or start_dt >= end_dt:
        return 0

    total_secs = (end_dt - start_dt).total_seconds()
    total_mins = int(total_secs // 60)
    if total_mins <= 0:
        return 0

    # Cap to prevent excessive loops (e.g. max 1440 mins = 24h)
    total_mins = min(total_mins, 1440)
    free_mins = 0
    curr = start_dt
    for _ in range(total_mins):
        in_free, _ = is_time_in_free_time(parsed_breaks, curr)
        if in_free:
            free_mins += 1
        curr += timedelta(minutes=1)

    return free_mins


def get_rotation_day_state(
    rotation_pattern: dict,
    ref_dt: Optional[datetime] = None,
) -> dict:
    """
    Calculate active status and exact shift window for a rotational shift schedule
    (e.g., 2 days, 2 nights, 1 off / 2 days, 2 nights, 2 off).

    Rotation configuration schema:
    {
        "pattern_type": "2d_2n_1off" | "2d_2n_2off" | "custom",
        "cycle": ["day", "day", "night", "night", "off"],
        "anchor_date": "2026-01-01",
        "day_start": "07:00",
        "day_end": "19:00",
        "night_start": "19:00",
        "night_end": "07:00",
        "grace_period_minutes": 15,
        "absence_timeout_minutes": 5,
    }
    """
    if ref_dt is None:
        ref_dt = datetime.now()

    cycle = rotation_pattern.get("cycle") or ["day", "day", "night", "night", "off"]
    if not isinstance(cycle, list) or len(cycle) == 0:
        cycle = ["day", "day", "night", "night", "off"]

    cycle_len = len(cycle)
    anchor_str = str(rotation_pattern.get("anchor_date") or "2026-01-01")[:10]
    try:
        anchor_date = datetime.strptime(anchor_str, "%Y-%m-%d").date()
    except Exception:
        anchor_date = datetime(2026, 1, 1).date()

    day_start_str = str(rotation_pattern.get("day_start") or "07:00").strip()
    day_end_str = str(rotation_pattern.get("day_end") or "19:00").strip()
    night_start_str = str(rotation_pattern.get("night_start") or "19:00").strip()
    night_end_str = str(rotation_pattern.get("night_end") or "07:00").strip()

    try:
        d_sh, d_sm = map(int, day_start_str.split(":"))
        d_eh, d_em = map(int, day_end_str.split(":"))
    except Exception:
        d_sh, d_sm, d_eh, d_em = 7, 0, 19, 0

    try:
        n_sh, n_sm = map(int, night_start_str.split(":"))
        n_eh, n_em = map(int, night_end_str.split(":"))
    except Exception:
        n_sh, n_sm, n_eh, n_em = 19, 0, 7, 0

    ref_date = ref_dt.date()
    days_since_anchor = (ref_date - anchor_date).days
    cycle_day_idx = days_since_anchor % cycle_len
    state_today = str(cycle[cycle_day_idx]).lower()

    # Previous day index (for overnight night-shift carryover)
    prev_day_idx = (days_since_anchor - 1) % cycle_len
    state_yesterday = str(cycle[prev_day_idx]).lower()

    ref_mins = ref_dt.hour * 60 + ref_dt.minute
    night_end_mins = n_eh * 60 + n_em

    # Check Case A: Overnight night-shift from yesterday morning carryover (e.g. 00:00 to 07:00)
    if state_yesterday == "night" and ref_mins <= night_end_mins:
        shift_start = datetime.combine(ref_date - timedelta(days=1), datetime.min.time()).replace(hour=n_sh, minute=n_sm)
        shift_end = datetime.combine(ref_date, datetime.min.time()).replace(hour=n_eh, minute=n_em)
        elapsed = max(0, int((ref_dt - shift_start).total_seconds() // 60))
        return {
            "is_active_now": True,
            "shift_kind": "night",
            "shift_name": f"شیفت شب (ادامه از دیشب - روز {prev_day_idx + 1} چرخه)",
            "cycle_day_index": prev_day_idx,
            "cycle_day_number": prev_day_idx + 1,
            "cycle_length": cycle_len,
            "cycle_states": cycle,
            "shift_start": shift_start,
            "shift_end": shift_end,
            "time_range": f"{night_start_str} - {night_end_str}",
            "is_overnight": True,
            "elapsed_minutes": elapsed,
        }

    # Case B: Scheduled today
    if state_today == "day":
        shift_start = datetime.combine(ref_date, datetime.min.time()).replace(hour=d_sh, minute=d_sm)
        shift_end = datetime.combine(ref_date, datetime.min.time()).replace(hour=d_eh, minute=d_em)
        is_active = (shift_start <= ref_dt <= shift_end)
        elapsed = max(0, int((ref_dt - shift_start).total_seconds() // 60)) if is_active else 0
        return {
            "is_active_now": is_active,
            "shift_kind": "day",
            "shift_name": f"شیفت روز (روز {cycle_day_idx + 1} از {cycle_len})",
            "cycle_day_index": cycle_day_idx,
            "cycle_day_number": cycle_day_idx + 1,
            "cycle_length": cycle_len,
            "cycle_states": cycle,
            "shift_start": shift_start,
            "shift_end": shift_end,
            "time_range": f"{day_start_str} - {day_end_str}",
            "is_overnight": False,
            "elapsed_minutes": elapsed,
        }
    elif state_today == "night":
        shift_start = datetime.combine(ref_date, datetime.min.time()).replace(hour=n_sh, minute=n_sm)
        shift_end = datetime.combine(ref_date + timedelta(days=1), datetime.min.time()).replace(hour=n_eh, minute=n_em)
        is_active = (ref_dt >= shift_start)
        elapsed = max(0, int((ref_dt - shift_start).total_seconds() // 60)) if is_active else 0
        return {
            "is_active_now": is_active,
            "shift_kind": "night",
            "shift_name": f"شیفت شب (روز {cycle_day_idx + 1} از {cycle_len})",
            "cycle_day_index": cycle_day_idx,
            "cycle_day_number": cycle_day_idx + 1,
            "cycle_length": cycle_len,
            "cycle_states": cycle,
            "shift_start": shift_start,
            "shift_end": shift_end,
            "time_range": f"{night_start_str} - {night_end_str}",
            "is_overnight": True,
            "elapsed_minutes": elapsed,
        }
    else:  # "off"
        return {
            "is_active_now": False,
            "shift_kind": "off",
            "shift_name": f"استراحت / آف (روز {cycle_day_idx + 1} از {cycle_len})",
            "cycle_day_index": cycle_day_idx,
            "cycle_day_number": cycle_day_idx + 1,
            "cycle_length": cycle_len,
            "cycle_states": cycle,
            "shift_start": None,
            "shift_end": None,
            "time_range": "استراحت / آف",
            "is_overnight": False,
            "elapsed_minutes": 0,
        }
