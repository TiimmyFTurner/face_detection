"""
Monthly Archive Management & Transparent Query Routing Service.

Provides:
  - Monthly partitioning of historical detection events into standalone SQLite databases:
      data/archives/YYYY_MM/events_YYYY_MM.db
  - Monthly partitioning of cropped face snapshots into archive folders:
      data/archives/YYYY_MM/snapshots/
  - Transparent snapshot resolution: serves images regardless of whether they
    are in the active snapshot folder or a historical monthly archive folder.
  - Transparent multi-database querying: executes searches, pagination, and
    exports across active and archived databases seamlessly.
  - Automated month-end archiving and manual on-demand triggers.
"""

import asyncio
import logging
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import async_session
from backend.models import Event

logger = logging.getLogger(__name__)

# Regex for monthly archive folder name (e.g. "2026_09")
MONTH_SLUG_REGEX = re.compile(r"^\d{4}_\d{2}$")

# In-memory cache for fast O(1) snapshot path lookups: filename -> resolved absolute Path
_snapshot_cache: Dict[str, Path] = {}
_MAX_SNAPSHOT_CACHE_SIZE = 20000


def get_archive_dir() -> Path:
    """Return the resolved Path to the configured archives directory."""
    if hasattr(settings, "get_effective_archive_dir"):
        p = settings.get_effective_archive_dir()
    else:
        raw = getattr(settings, "archive_dir", "./data/archives")
        clean = str(raw).strip().strip('"\'')
        p = Path(clean).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_month_slug(year: int, month: int) -> str:
    """Return standard folder/file slug for a month (e.g. '2026_09')."""
    return f"{year:04d}_{month:02d}"


def get_month_date_range(year: int, month: int) -> Tuple[datetime, datetime]:
    """
    Return UTC datetime range [start_dt, end_dt) for the given year and month.
    start_dt is inclusive (first second of the month).
    end_dt is exclusive (first second of the following month).
    """
    start_dt = datetime(year, month, 1, 0, 0, 0, tzinfo=timezone.utc)
    if month == 12:
        end_dt = datetime(year + 1, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    else:
        end_dt = datetime(year, month + 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    return start_dt, end_dt


def get_previous_month() -> Tuple[int, int]:
    """Return (year, month) of the previous calendar month relative to UTC now."""
    now = datetime.now(timezone.utc)
    if now.month == 1:
        return now.year - 1, 12
    return now.year, now.month - 1


def get_archive_month_dir(year: int, month: int) -> Path:
    """Return Path to a specific month's archive directory."""
    slug = get_month_slug(year, month)
    return get_archive_dir() / slug


def get_archive_db_path(year: int, month: int) -> Path:
    """Return Path to a specific month's SQLite events database."""
    slug = get_month_slug(year, month)
    return get_archive_month_dir(year, month) / f"events_{slug}.db"


def get_archive_snapshots_dir(year: int, month: int) -> Path:
    """Return Path to a specific month's snapshots directory."""
    return get_archive_month_dir(year, month) / "snapshots"


def init_archive_db(db_path: Path) -> None:
    """
    Initialize a standalone SQLite archive database with the events table and indexes.
    Uses native sqlite3 to ensure portable, standalone creation without SQLAlchemy dependencies.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(db_path)) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY,
                timestamp DATETIME,
                camera_id INTEGER,
                person_id INTEGER,
                person_name VARCHAR(255) DEFAULT 'Unknown',
                confidence_score FLOAT DEFAULT 0.0,
                snapshot_path TEXT NOT NULL,
                is_known BOOLEAN DEFAULT 0,
                zone_id INTEGER,
                zone_name VARCHAR(255) DEFAULT '',
                alert_type VARCHAR(50) DEFAULT 'normal',
                duration_seconds INTEGER
            );
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_events_timestamp ON events(timestamp);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_events_camera_id ON events(camera_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_events_person_id ON events(person_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_events_is_known ON events(is_known);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_events_alert_type ON events(alert_type);")
        conn.commit()


# ═══════════════════════════════════════════════════════════
# Snapshot Resolution (Transparent Active + Archives)
# ═══════════════════════════════════════════════════════════

def find_snapshot_file(filename: str) -> Optional[Path]:
    """
    Transparently locate a snapshot file on disk.

    Search sequence:
      1. Reference photos directory (if prefixed with 'ref_')
      2. Active snapshot directory (data/snapshots/)
      3. In-memory fast cache
      4. Monthly archive snapshot directories (data/archives/*/snapshots/)

    Returns:
      Resolved Path if found, otherwise None.
    """
    if not filename:
        return None

    safe_name = Path(filename).name
    if safe_name != filename or ".." in filename:
        return None

    # 1. Reference photo
    if safe_name.startswith("ref_"):
        ref_path = Path(settings.reference_photo_dir) / safe_name[4:]
        return ref_path if ref_path.is_file() else None

    # 2. Active directory
    active_path = Path(settings.snapshot_dir) / safe_name
    if active_path.is_file():
        return active_path

    # 3. Check memory cache
    cached_path = _snapshot_cache.get(safe_name)
    if cached_path and cached_path.is_file():
        return cached_path
    elif cached_path:
        _snapshot_cache.pop(safe_name, None)

    # 4. Search across monthly archive directories
    archive_dir = get_archive_dir()
    if archive_dir.is_dir():
        # Iterate over monthly directories in reverse order (newest first)
        for month_folder in sorted(archive_dir.iterdir(), reverse=True):
            if month_folder.is_dir() and MONTH_SLUG_REGEX.match(month_folder.name):
                snap_candidate = month_folder / "snapshots" / safe_name
                if snap_candidate.is_file():
                    if len(_snapshot_cache) >= _MAX_SNAPSHOT_CACHE_SIZE:
                        _snapshot_cache.clear()
                    _snapshot_cache[safe_name] = snap_candidate
                    return snap_candidate

    return None


def invalidate_snapshot_cache() -> None:
    """Clear snapshot lookup cache (called after archive migrations)."""
    _snapshot_cache.clear()


# ═══════════════════════════════════════════════════════════
# Archive Inspection & Listing
# ═══════════════════════════════════════════════════════════

def list_monthly_archives() -> List[Dict[str, Any]]:
    """
    List all available monthly archives on disk with event counts, snapshot counts,
    and storage sizes.
    """
    archive_dir = get_archive_dir()
    results = []

    if not archive_dir.is_dir():
        return results

    for folder in sorted(archive_dir.iterdir(), reverse=True):
        if not folder.is_dir() or not MONTH_SLUG_REGEX.match(folder.name):
            continue

        slug = folder.name
        db_file = folder / f"events_{slug}.db"
        snapshots_folder = folder / "snapshots"

        events_count = 0
        db_size_mb = 0.0
        snapshots_count = 0
        snapshots_size_mb = 0.0

        if db_file.is_file():
            db_size_mb = round(db_file.stat().st_size / (1024 * 1024), 2)
            try:
                with sqlite3.connect(f"file:{db_file}?mode=ro", uri=True) as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT count(*) FROM events;")
                    row = cur.fetchone()
                    if row:
                        events_count = row[0]
            except Exception as e:
                logger.warning("Could not read event count from archive %s: %s", db_file, e)

        if snapshots_folder.is_dir():
            snap_bytes = 0
            for entry in os.scandir(snapshots_folder):
                if entry.is_file() and entry.name.lower().endswith((".jpg", ".jpeg", ".png")):
                    snapshots_count += 1
                    try:
                        snap_bytes += entry.stat().st_size
                    except OSError:
                        pass
            snapshots_size_mb = round(snap_bytes / (1024 * 1024), 2)

        results.append({
            "year_month": slug,
            "db_path": str(db_file),
            "events_count": events_count,
            "db_size_mb": db_size_mb,
            "snapshots_count": snapshots_count,
            "snapshots_size_mb": snapshots_size_mb,
            "has_snapshots_folder": snapshots_folder.is_dir(),
        })

    return results


# ═══════════════════════════════════════════════════════════
# Monthly Archiving Engine
# ═══════════════════════════════════════════════════════════

async def archive_month(year: int, month: int, purge_from_active: bool = True) -> Dict[str, Any]:
    """
    Archive all events and snapshot images for a specified year and month.

    Steps:
      1. Calculate date boundaries [start_dt, end_dt) in UTC.
      2. Ensure archive directory & snapshots directory exist.
      3. Initialize events_YYYY_MM.db schema.
      4. Query matching events from active database.
      5. Insert rows into archive database.
      6. Move snapshot files from active snapshot directory to archive snapshots directory.
      7. If purge_from_active, delete rows from active database and commit.
      8. Run VACUUM on active database to reclaim disk space.
    """
    slug = get_month_slug(year, month)
    start_dt, end_dt = get_month_date_range(year, month)

    month_dir = get_archive_month_dir(year, month)
    snapshots_dir = get_archive_snapshots_dir(year, month)
    month_dir.mkdir(parents=True, exist_ok=True)
    snapshots_dir.mkdir(parents=True, exist_ok=True)

    db_path = get_archive_db_path(year, month)
    init_archive_db(db_path)

    events_copied = 0
    snapshots_moved = 0
    freed_bytes = 0

    active_snap_dir = Path(settings.snapshot_dir).resolve()

    logger.info("Starting archive process for %s (range %s to %s)...", slug, start_dt, end_dt)

    async with async_session() as session:
        # Fetch events for the month
        stmt = (
            select(Event)
            .where(Event.timestamp >= start_dt, Event.timestamp < end_dt)
            .order_by(Event.timestamp.asc())
        )
        res = await session.execute(stmt)
        events = res.scalars().all()

        if not events:
            logger.info("No events found in active DB for %s. Nothing to archive.", slug)
            return {
                "success": True,
                "year_month": slug,
                "events_archived": 0,
                "snapshots_moved": 0,
                "freed_mb": 0.0,
                "message": f"No events found for {slug} in the active database.",
            }

        # Insert records into archive DB in a synchronous thread
        def _write_archive_events(ev_list: list[Event]) -> int:
            with sqlite3.connect(str(db_path)) as conn:
                cur = conn.cursor()
                rows = [
                    (
                        ev.id,
                        ev.timestamp.isoformat() if ev.timestamp else None,
                        ev.camera_id,
                        ev.person_id,
                        ev.person_name,
                        ev.confidence_score,
                        ev.snapshot_path,
                        1 if ev.is_known else 0,
                        ev.zone_id,
                        ev.zone_name,
                        ev.alert_type,
                        ev.duration_seconds,
                    )
                    for ev in ev_list
                ]
                cur.executemany(
                    """
                    INSERT OR REPLACE INTO events (
                        id, timestamp, camera_id, person_id, person_name,
                        confidence_score, snapshot_path, is_known, zone_id,
                        zone_name, alert_type, duration_seconds
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    rows,
                )
                conn.commit()
                return len(rows)

        events_copied = await asyncio.to_thread(_write_archive_events, events)

        # Move snapshot files to archive directory
        for ev in events:
            if ev.snapshot_path and not ev.snapshot_path.startswith("ref_"):
                safe_name = Path(ev.snapshot_path).name
                src_path = active_snap_dir / safe_name
                if src_path.is_file():
                    dst_path = snapshots_dir / safe_name
                    try:
                        fsize = src_path.stat().st_size
                        shutil.move(str(src_path), str(dst_path))
                        snapshots_moved += 1
                        freed_bytes += fsize
                    except Exception as err:
                        logger.warning("Could not move snapshot %s to archive: %s", src_path, err)

        # Purge from active DB if requested
        if purge_from_active and events_copied > 0:
            for ev in events:
                await session.delete(ev)
            await session.commit()
            logger.info("Purged %d archived events from active database.", events_copied)

            # Reclaim disk space via VACUUM
            try:
                await session.execute(text("VACUUM;"))
            except Exception as v_err:
                logger.debug("Active DB VACUUM skipped or unneeded: %s", v_err)

    invalidate_snapshot_cache()

    freed_mb = round(freed_bytes / (1024 * 1024), 2)
    logger.info(
        "Archiving of %s completed: %d events copied, %d snapshots moved (freed %.2f MB).",
        slug,
        events_copied,
        snapshots_moved,
        freed_mb,
    )

    return {
        "success": True,
        "year_month": slug,
        "events_archived": events_copied,
        "snapshots_moved": snapshots_moved,
        "freed_mb": freed_mb,
        "message": f"Successfully archived month {slug} ({events_copied} events, {snapshots_moved} snapshots, {freed_mb} MB freed).",
    }


# ═══════════════════════════════════════════════════════════
# Multi-DB Query Routing (Transparent Queries Across Months)
# ═══════════════════════════════════════════════════════════

def get_relevant_archive_dbs(
    start_dt: Optional[datetime] = None,
    end_dt: Optional[datetime] = None,
) -> List[Tuple[str, Path]]:
    """
    Identify which monthly archive databases overlap with the requested [start_dt, end_dt] window.
    Returns list of (year_month, db_path) sorted in descending order (newest month first).
    """
    archive_dir = get_archive_dir()
    if not archive_dir.is_dir():
        return []

    relevant = []
    for folder in sorted(archive_dir.iterdir(), reverse=True):
        if not folder.is_dir() or not MONTH_SLUG_REGEX.match(folder.name):
            continue

        slug = folder.name
        db_path = folder / f"events_{slug}.db"
        if not db_path.is_file():
            continue

        try:
            parts = slug.split("_")
            y, m = int(parts[0]), int(parts[1])
            m_start, m_end = get_month_date_range(y, m)
        except Exception:
            continue

        # Check overlap
        if start_dt is not None and m_end <= start_dt:
            continue
        if end_dt is not None and m_start > end_dt:
            continue

        relevant.append((slug, db_path))

    return relevant


def _build_sql_conditions_for_archive(
    camera_id: Optional[int] = None,
    person_id: Optional[int] = None,
    person_name: Optional[str] = None,
    search: Optional[str] = None,
    is_known: Optional[bool] = None,
    has_snapshot: Optional[bool] = None,
    start_dt: Optional[datetime] = None,
    end_dt: Optional[datetime] = None,
    scope_camera_ids: Optional[list[int]] = None,
    scope_person_ids: Optional[list[int]] = None,
    is_scoped: bool = False,
) -> Tuple[str, list]:
    """Build parameterized SQL WHERE conditions for an archive SQLite database query."""
    clauses = ["1=1"]
    params = []

    if camera_id is not None:
        clauses.append("camera_id = ?")
        params.append(camera_id)
    if person_id is not None:
        clauses.append("person_id = ?")
        params.append(person_id)
    if is_known is not None:
        clauses.append("is_known = ?")
        params.append(1 if is_known else 0)
    if has_snapshot is True:
        clauses.append("snapshot_path IS NOT NULL AND snapshot_path != ''")
    elif has_snapshot is False:
        clauses.append("(snapshot_path IS NULL OR snapshot_path = '')")
    if person_name is not None and person_name.strip():
        clauses.append("person_name LIKE ?")
        params.append(f"%{person_name.strip()}%")
    if search is not None and search.strip():
        clauses.append("person_name LIKE ?")
        params.append(f"%{search.strip()}%")

    if start_dt is not None:
        clauses.append("timestamp >= ?")
        params.append(start_dt.isoformat().replace("+00:00", ""))
    if end_dt is not None:
        clauses.append("timestamp <= ?")
        params.append(end_dt.isoformat().replace("+00:00", ""))

    # Scope filtering for supervisors
    if is_scoped:
        scope_conditions = []
        if scope_camera_ids:
            placeholders = ",".join("?" for _ in scope_camera_ids)
            scope_conditions.append(f"camera_id IN ({placeholders})")
            params.extend(scope_camera_ids)
        if scope_person_ids:
            placeholders = ",".join("?" for _ in scope_person_ids)
            scope_conditions.append(f"person_id IN ({placeholders})")
            params.extend(scope_person_ids)
        if scope_conditions:
            clauses.append(f"({' OR '.join(scope_conditions)})")
        else:
            clauses.append("1=0")

    return " AND ".join(clauses), params


def query_archive_db(
    db_path: Path,
    where_sql: str,
    params: list,
    limit: int,
    offset: int,
) -> Tuple[List[Dict[str, Any]], int]:
    """Execute count and paginated query on a single archive SQLite database."""
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Count total matches
        cur.execute(f"SELECT count(*) FROM events WHERE {where_sql}", params)
        total = cur.fetchone()[0]
        if total == 0 or offset >= total or limit <= 0:
            return [], total

        # Query slice
        query = f"""
            SELECT id, timestamp, camera_id, person_id, person_name,
                   confidence_score, snapshot_path, is_known, zone_id,
                   zone_name, alert_type, duration_seconds
            FROM events
            WHERE {where_sql}
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """
        cur.execute(query, params + [limit, offset])
        rows = [dict(row) for row in cur.fetchall()]
        return rows, total


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse ISO 8601 string safely into a timezone-aware UTC datetime."""
    if not value:
        return None
    v = str(value).strip()
    if not v:
        return None

    if " " in v and "+" not in v:
        parts = v.split(" ")
        if len(parts) == 2 and (":" in parts[1] or len(parts[1]) == 5):
            v = parts[0] + "+" + parts[1]
    if v.endswith("Z") or v.endswith("z"):
        v = v[:-1] + "+00:00"

    try:
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        else:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception as err:
        logger.warning("Failed to parse datetime query parameter '%s': %s", value, err)
        return None


def _format_event_row(row: dict) -> dict:
    """Format an archive SQLite row dictionary so it mirrors SQLAlchemy Event fields."""
    d = dict(row)
    ts = d.get("timestamp")
    if isinstance(ts, str):
        try:
            ts_str = ts.replace(" ", "T")
            if not ts_str.endswith("Z") and "+" not in ts_str:
                ts_str += "+00:00"
            parsed_ts = datetime.fromisoformat(ts_str)
            if parsed_ts.tzinfo is None:
                parsed_ts = parsed_ts.replace(tzinfo=timezone.utc)
            d["timestamp"] = parsed_ts
        except Exception:
            pass
    elif isinstance(ts, datetime) and ts.tzinfo is None:
        d["timestamp"] = ts.replace(tzinfo=timezone.utc)

    d["is_known"] = bool(d.get("is_known", 0))
    d["confidence_score"] = float(d.get("confidence_score") or 0.0)
    return d


async def query_events_multi_db(
    db: AsyncSession,
    camera_id: Optional[int] = None,
    person_id: Optional[int] = None,
    person_name: Optional[str] = None,
    search: Optional[str] = None,
    is_known: Optional[bool] = None,
    has_snapshot: Optional[bool] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    is_scoped: bool = False,
    scope_camera_ids: Optional[list[int]] = None,
    scope_person_ids: Optional[list[int]] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Transparently query events across active database and monthly archive databases.

    Queries are executed in reverse chronological order:
      1. Active database (recent events)
      2. Monthly archive databases (newest to oldest)

    Total matching count is aggregated, and results are paginated seamlessly
    with global descending timestamp sorting.
    """
    from sqlalchemy import and_, or_
    from backend.models import Camera

    start_dt = parse_iso_datetime(start_time)
    end_dt = parse_iso_datetime(end_time)

    # 1. Discover all relevant archive databases
    relevant_archives = get_relevant_archive_dbs(start_dt, end_dt)

    # 2. Build SQLAlchemy conditions for active database
    active_conditions = []
    if camera_id is not None:
        active_conditions.append(Event.camera_id == camera_id)
    if person_id is not None:
        active_conditions.append(Event.person_id == person_id)
    if is_known is not None:
        active_conditions.append(Event.is_known == is_known)
    if has_snapshot is True:
        active_conditions.append(and_(Event.snapshot_path.isnot(None), Event.snapshot_path != ""))
    elif has_snapshot is False:
        active_conditions.append(or_(Event.snapshot_path.is_(None), Event.snapshot_path == ""))
    if person_name is not None and person_name.strip():
        active_conditions.append(Event.person_name.ilike(f"%{person_name.strip()}%"))
    if search is not None and search.strip():
        search_term = f"%{search.strip()}%"
        cam_subquery = select(Camera.id).where(
            or_(
                Camera.name.ilike(search_term),
                Camera.location.ilike(search_term),
            )
        )
        active_conditions.append(
            or_(
                Event.person_name.ilike(search_term),
                Event.camera_id.in_(cam_subquery),
            )
        )
    if start_dt is not None:
        active_conditions.append(Event.timestamp >= start_dt)
    if end_dt is not None:
        active_conditions.append(Event.timestamp <= end_dt)

    if is_scoped:
        scope_clauses = []
        if scope_camera_ids:
            scope_clauses.append(Event.camera_id.in_(scope_camera_ids))
        if scope_person_ids:
            scope_clauses.append(Event.person_id.in_(scope_person_ids))
        if scope_clauses:
            active_conditions.append(or_(*scope_clauses))
        else:
            active_conditions.append(Event.id == -1)

    active_where = and_(*active_conditions) if active_conditions else True

    # Check active DB count
    active_count_q = select(func.count(Event.id)).where(active_where)
    active_res = await db.execute(active_count_q)
    active_count = active_res.scalar() or 0

    # 3. If no relevant archives exist, query active database directly
    if not relevant_archives:
        if active_count == 0 or offset >= active_count or limit <= 0:
            return [], active_count

        active_query = (
            select(Event)
            .where(active_where)
            .order_by(Event.timestamp.desc())
            .limit(limit)
            .offset(offset)
        )
        q_res = await db.execute(active_query)
        events = q_res.scalars().all()
        rows = [
            _format_event_row({
                "id": ev.id,
                "timestamp": ev.timestamp,
                "camera_id": ev.camera_id,
                "person_id": ev.person_id,
                "person_name": ev.person_name,
                "confidence_score": ev.confidence_score,
                "snapshot_path": ev.snapshot_path,
                "is_known": ev.is_known,
                "zone_id": getattr(ev, "zone_id", None),
                "zone_name": getattr(ev, "zone_name", ""),
                "alert_type": getattr(ev, "alert_type", "normal"),
                "duration_seconds": getattr(ev, "duration_seconds", None),
            })
            for ev in events
        ]
        return rows, active_count

    # 4. Multi-DB querying: Active DB + Archives in reverse chronological sequence
    archive_queries_info = []
    total_matches = active_count

    # Pre-calculate counts from each relevant archive database in parallel threads
    for slug, db_path in relevant_archives:
        where_sql, params = _build_sql_conditions_for_archive(
            camera_id=camera_id,
            person_id=person_id,
            person_name=person_name,
            search=search,
            is_known=is_known,
            has_snapshot=has_snapshot,
            start_dt=start_dt,
            end_dt=end_dt,
            scope_camera_ids=scope_camera_ids,
            scope_person_ids=scope_person_ids,
            is_scoped=is_scoped,
        )

        def _count_archive(path=db_path, w=where_sql, p=params):
            with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
                cur = conn.cursor()
                cur.execute(f"SELECT count(*) FROM events WHERE {w}", p)
                return cur.fetchone()[0]

        arch_count = await asyncio.to_thread(_count_archive)
        total_matches += arch_count
        archive_queries_info.append({
            "slug": slug,
            "db_path": db_path,
            "where_sql": where_sql,
            "params": params,
            "count": arch_count,
        })

    if total_matches == 0 or offset >= total_matches or limit <= 0:
        return [], total_matches

    # 5. Fetch rows across sources using cursor pagination
    results = []
    curr_offset = offset

    # A. Active DB source
    if active_count > 0:
        if curr_offset >= active_count:
            curr_offset -= active_count
        else:
            take = min(limit - len(results), active_count - curr_offset)
            active_q = (
                select(Event)
                .where(active_where)
                .order_by(Event.timestamp.desc())
                .limit(take)
                .offset(curr_offset)
            )
            act_res = await db.execute(active_q)
            for ev in act_res.scalars().all():
                results.append(_format_event_row({
                    "id": ev.id,
                    "timestamp": ev.timestamp,
                    "camera_id": ev.camera_id,
                    "person_id": ev.person_id,
                    "person_name": ev.person_name,
                    "confidence_score": ev.confidence_score,
                    "snapshot_path": ev.snapshot_path,
                    "is_known": ev.is_known,
                    "zone_id": getattr(ev, "zone_id", None),
                    "zone_name": getattr(ev, "zone_name", ""),
                    "alert_type": getattr(ev, "alert_type", "normal"),
                    "duration_seconds": getattr(ev, "duration_seconds", None),
                }))
            curr_offset = 0

    # B. Archive DB sources (newest month to oldest month)
    for arch in archive_queries_info:
        if len(results) >= limit:
            break
        arch_cnt = arch["count"]
        if arch_cnt <= 0:
            continue

        if curr_offset >= arch_cnt:
            curr_offset -= arch_cnt
            continue

        take = min(limit - len(results), arch_cnt - curr_offset)
        arch_rows, _ = await asyncio.to_thread(
            query_archive_db,
            arch["db_path"],
            arch["where_sql"],
            arch["params"],
            take,
            curr_offset,
        )
        for r in arch_rows:
            results.append(_format_event_row(r))
        curr_offset = 0

    return results, total_matches

