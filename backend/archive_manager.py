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

from sqlalchemy import and_, delete, func, or_, select, text
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

    # Normalize callers' bounds to naive UTC for safe, uniform comparisons
    s_dt = _normalize_utc_naive(start_dt) if start_dt is not None else None
    e_dt = _normalize_utc_naive(end_dt) if end_dt is not None else None

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
            m_start_naive = m_start.replace(tzinfo=None)
            m_end_naive = m_end.replace(tzinfo=None)
        except Exception:
            continue

        # Check overlap
        if s_dt is not None and m_end_naive <= s_dt:
            continue
        if e_dt is not None and m_start_naive > e_dt:
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
            scope_conditions.append(f"(person_id IN ({placeholders}) AND (alert_type IS NULL OR alert_type != 'camera_disconnected'))")
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
            scope_clauses.append(
                and_(
                    Event.person_id.in_(scope_person_ids),
                    Event.alert_type != "camera_disconnected",
                )
            )
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


# ═══════════════════════════════════════════════════════════
# Person Analytics & Roster Transparent Multi-DB Fetchers
# ═══════════════════════════════════════════════════════════

class ArchivedEvent:
    """Lightweight Event-compatible object representing an event row from an archive SQLite DB."""
    __slots__ = (
        "id",
        "timestamp",
        "camera_id",
        "person_id",
        "person_name",
        "confidence_score",
        "snapshot_path",
        "is_known",
        "zone_id",
        "zone_name",
        "alert_type",
        "duration_seconds",
    )

    def __init__(
        self,
        id: int,
        timestamp: datetime,
        camera_id: Optional[int] = None,
        person_id: Optional[int] = None,
        person_name: str = "Unknown",
        confidence_score: float = 0.0,
        snapshot_path: str = "",
        is_known: bool = True,
        zone_id: Optional[int] = None,
        zone_name: str = "",
        alert_type: str = "normal",
        duration_seconds: Optional[int] = None,
    ):
        self.id = id
        self.timestamp = timestamp
        self.camera_id = camera_id
        self.person_id = person_id
        self.person_name = person_name or "Unknown"
        self.confidence_score = float(confidence_score or 0.0)
        self.snapshot_path = snapshot_path or ""
        self.is_known = bool(is_known)
        self.zone_id = zone_id
        self.zone_name = zone_name or ""
        self.alert_type = alert_type or "normal"
        self.duration_seconds = duration_seconds

    def __repr__(self) -> str:
        return (
            f"<ArchivedEvent id={self.id} person='{self.person_name}' "
            f"confidence={self.confidence_score:.2f} alert={self.alert_type}>"
        )


def _normalize_utc_naive(dt: Any) -> datetime:
    """Normalize string or datetime to naive UTC datetime for uniform comparison and arithmetic."""
    if dt is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    if isinstance(dt, str):
        s = dt.strip().replace(" ", "T")
        if s.endswith("Z") or s.endswith("z"):
            s = s[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(s)
            if parsed.tzinfo is not None:
                return parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except Exception:
            return datetime.now(timezone.utc).replace(tzinfo=None)
    if isinstance(dt, datetime):
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def get_person_events_multi_db(
    db: AsyncSession,
    person_id: int,
    start_dt: Optional[datetime] = None,
    end_dt: Optional[datetime] = None,
    exclude_system_alerts: bool = True,
) -> List[Any]:
    """
    Transparently fetch face detection events for a person across the active database
    and all relevant monthly archive databases.
    Returns all matching events sorted in descending order of timestamp.
    """
    # 1. Fetch from active DB
    active_conditions = [Event.person_id == person_id]
    if exclude_system_alerts:
        active_conditions.append(
            or_(
                Event.alert_type.is_(None),
                Event.alert_type.notin_(["absence_timeout", "camera_disconnected"]),
            )
        )
    if start_dt is not None:
        active_conditions.append(Event.timestamp >= _normalize_utc_naive(start_dt))
    if end_dt is not None:
        active_conditions.append(Event.timestamp <= _normalize_utc_naive(end_dt))

    active_stmt = (
        select(Event)
        .where(and_(*active_conditions))
        .order_by(Event.timestamp.desc())
    )
    active_res = await db.execute(active_stmt)
    active_events = list(active_res.scalars().all())

    # Ensure active event timestamps are naive UTC for consistent arithmetic
    for ev in active_events:
        if ev.timestamp is not None and ev.timestamp.tzinfo is not None:
            ev.timestamp = ev.timestamp.astimezone(timezone.utc).replace(tzinfo=None)

    # 2. Discover relevant archive databases
    relevant_archives = get_relevant_archive_dbs(start_dt, end_dt)
    if not relevant_archives:
        return active_events

    # 3. Query relevant archive databases in background thread
    def _query_archive(path: Path) -> List[ArchivedEvent]:
        clauses = ["person_id = ?"]
        params: list[Any] = [person_id]
        if exclude_system_alerts:
            clauses.append("(alert_type IS NULL OR alert_type NOT IN ('absence_timeout', 'camera_disconnected'))")
        if start_dt is not None:
            clauses.append("timestamp >= ?")
            params.append(_normalize_utc_naive(start_dt).isoformat())
        if end_dt is not None:
            clauses.append("timestamp <= ?")
            params.append(_normalize_utc_naive(end_dt).isoformat())

        where_sql = " AND ".join(clauses)
        sql = f"""
            SELECT id, timestamp, camera_id, person_id, person_name,
                   confidence_score, snapshot_path, is_known, zone_id,
                   zone_name, alert_type, duration_seconds
            FROM events
            WHERE {where_sql}
            ORDER BY timestamp DESC
        """
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall()
            return [
                ArchivedEvent(
                    id=r["id"],
                    timestamp=_normalize_utc_naive(r["timestamp"]),
                    camera_id=r["camera_id"],
                    person_id=r["person_id"],
                    person_name=r["person_name"],
                    confidence_score=r["confidence_score"],
                    snapshot_path=r["snapshot_path"],
                    is_known=r["is_known"],
                    zone_id=r["zone_id"],
                    zone_name=r["zone_name"],
                    alert_type=r["alert_type"],
                    duration_seconds=r["duration_seconds"],
                )
                for r in rows
            ]

    archive_events: list[ArchivedEvent] = []
    for slug, db_path in relevant_archives:
        arch_rows = await asyncio.to_thread(_query_archive, db_path)
        archive_events.extend(arch_rows)

    all_events = active_events + archive_events
    all_events.sort(key=lambda ev: ev.timestamp, reverse=True)
    return all_events


async def get_person_latest_event_multi_db(
    db: AsyncSession,
    person_id: int,
) -> Optional[Any]:
    """
    Retrieve the most recent event for a person across the active DB and monthly archives.
    """
    # 1. Active database check
    stmt = (
        select(Event)
        .where(Event.person_id == person_id)
        .order_by(Event.timestamp.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    ev = res.scalar()
    if ev:
        return ev

    # 2. Check archives (newest to oldest)
    relevant_archives = get_relevant_archive_dbs(None, None)
    if not relevant_archives:
        return None

    def _find_latest_in_archive(path: Path) -> Optional[ArchivedEvent]:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, timestamp, camera_id, person_id, person_name,
                       confidence_score, snapshot_path, is_known, zone_id,
                       zone_name, alert_type, duration_seconds
                FROM events
                WHERE person_id = ?
                ORDER BY timestamp DESC
                LIMIT 1
                """,
                (person_id,),
            )
            row = cur.fetchone()
            if row:
                return ArchivedEvent(
                    id=row["id"],
                    timestamp=_normalize_utc_naive(row["timestamp"]),
                    camera_id=row["camera_id"],
                    person_id=row["person_id"],
                    person_name=row["person_name"],
                    confidence_score=row["confidence_score"],
                    snapshot_path=row["snapshot_path"],
                    is_known=row["is_known"],
                    zone_id=row["zone_id"],
                    zone_name=row["zone_name"],
                    alert_type=row["alert_type"],
                    duration_seconds=row["duration_seconds"],
                )
            return None

    for slug, db_path in relevant_archives:
        arch_ev = await asyncio.to_thread(_find_latest_in_archive, db_path)
        if arch_ev:
            return arch_ev

    return None


async def get_events_since_multi_db(
    db: AsyncSession,
    since_dt: datetime,
) -> List[Any]:
    """
    Fetch events occurring on or after since_dt across active DB and relevant monthly archives.
    Sorted ascending by timestamp.
    """
    since_naive = _normalize_utc_naive(since_dt)

    # 1. Active DB
    stmt = (
        select(Event)
        .where(Event.timestamp >= since_naive)
        .order_by(Event.timestamp.asc())
    )
    res = await db.execute(stmt)
    active_events = list(res.scalars().all())
    for ev in active_events:
        if ev.timestamp is not None and ev.timestamp.tzinfo is not None:
            ev.timestamp = ev.timestamp.astimezone(timezone.utc).replace(tzinfo=None)

    # 2. Archives overlapping since_dt
    relevant_archives = get_relevant_archive_dbs(since_dt, None)
    if not relevant_archives:
        return active_events

    def _query_archive(path: Path) -> List[ArchivedEvent]:
        sql = """
            SELECT id, timestamp, camera_id, person_id, person_name,
                   confidence_score, snapshot_path, is_known, zone_id,
                   zone_name, alert_type, duration_seconds
            FROM events
            WHERE timestamp >= ?
            ORDER BY timestamp ASC
        """
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(sql, (since_naive.isoformat(),))
            rows = cur.fetchall()
            return [
                ArchivedEvent(
                    id=r["id"],
                    timestamp=_normalize_utc_naive(r["timestamp"]),
                    camera_id=r["camera_id"],
                    person_id=r["person_id"],
                    person_name=r["person_name"],
                    confidence_score=r["confidence_score"],
                    snapshot_path=r["snapshot_path"],
                    is_known=r["is_known"],
                    zone_id=r["zone_id"],
                    zone_name=r["zone_name"],
                    alert_type=r["alert_type"],
                    duration_seconds=r["duration_seconds"],
                )
                for r in rows
            ]

    arch_events: list[ArchivedEvent] = []
    for slug, db_path in relevant_archives:
        rows = await asyncio.to_thread(_query_archive, db_path)
        arch_events.extend(rows)

    all_events = active_events + arch_events
    all_events.sort(key=lambda ev: ev.timestamp)
    return all_events


# ═══════════════════════════════════════════════════════════
# Historical Archive Retention & Storage Cleanup
# ═══════════════════════════════════════════════════════════

def cleanup_archived_snapshots(cutoff: datetime) -> Tuple[int, int, int]:
    """
    Clean up expired snapshot images from all monthly archives on disk and
    clear their references in corresponding archive SQLite databases.

    Parameters:
      cutoff: Cutoff datetime in UTC. Any event/snapshot older than this is purged.

    Returns:
      Tuple of (deleted_files_count, freed_bytes, records_updated_count)
    """
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)
    else:
        cutoff = cutoff.astimezone(timezone.utc)

    archive_dir = get_archive_dir()
    if not archive_dir.is_dir():
        return 0, 0, 0

    cutoff_epoch = cutoff.timestamp()
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    total_deleted_files = 0
    total_freed_bytes = 0
    total_records_updated = 0

    for folder in sorted(archive_dir.iterdir()):
        if not folder.is_dir() or not MONTH_SLUG_REGEX.match(folder.name):
            continue

        slug = folder.name
        try:
            parts = slug.split("_")
            y, m = int(parts[0]), int(parts[1])
            m_start, m_end = get_month_date_range(y, m)
        except Exception:
            continue

        # If the entire month starts strictly after cutoff, nothing in it is expired.
        if m_start > cutoff:
            continue

        db_path = folder / f"events_{slug}.db"
        snapshots_dir = folder / "snapshots"
        deleted_in_folder = set()

        if db_path.is_file():
            try:
                with sqlite3.connect(str(db_path)) as conn:
                    conn.execute("PRAGMA busy_timeout = 5000;")
                    cur = conn.cursor()

                    if m_end <= cutoff:
                        # Entire month ended before cutoff -> all events in this month are expired
                        cur.execute(
                            "SELECT id, snapshot_path FROM events WHERE snapshot_path IS NOT NULL AND snapshot_path != '';"
                        )
                    else:
                        # Month spans cutoff -> only events older than cutoff are expired
                        cur.execute(
                            """
                            SELECT id, snapshot_path FROM events
                            WHERE snapshot_path IS NOT NULL AND snapshot_path != ''
                              AND datetime(timestamp) < datetime(?);
                            """,
                            (cutoff_str,),
                        )

                    rows = cur.fetchall()
                    ids_to_clear = []

                    for row in rows:
                        ev_id, raw_snap = row[0], row[1]
                        ids_to_clear.append(ev_id)

                        if not raw_snap or raw_snap.startswith("ref_"):
                            continue
                        safe_name = Path(raw_snap).name
                        if safe_name != raw_snap or ".." in raw_snap:
                            continue

                        file_path = (snapshots_dir / safe_name).resolve()
                        if snapshots_dir.resolve() in file_path.parents and file_path.is_file():
                            try:
                                sz = file_path.stat().st_size
                                file_path.unlink(missing_ok=True)
                                total_deleted_files += 1
                                total_freed_bytes += sz
                                deleted_in_folder.add(safe_name)
                            except OSError as e:
                                logger.warning("Could not delete archived snapshot %s: %s", file_path, e)

                    if ids_to_clear:
                        if m_end <= cutoff:
                            cur.execute(
                                "UPDATE events SET snapshot_path = '' WHERE snapshot_path IS NOT NULL AND snapshot_path != '';"
                            )
                        else:
                            chunk_size = 500
                            for i in range(0, len(ids_to_clear), chunk_size):
                                chunk = ids_to_clear[i : i + chunk_size]
                                placeholders = ",".join("?" for _ in chunk)
                                cur.execute(
                                    f"UPDATE events SET snapshot_path = '' WHERE id IN ({placeholders});",
                                    chunk,
                                )
                        conn.commit()
                        total_records_updated += len(ids_to_clear)

                        try:
                            conn.execute("VACUUM;")
                        except Exception:
                            pass
            except Exception as e:
                logger.error("Error cleaning archived snapshots in %s: %s", db_path, e)

        # Also clean orphaned image files on disk in snapshots_dir
        if snapshots_dir.is_dir():
            try:
                for entry in os.scandir(snapshots_dir):
                    if not entry.is_file():
                        continue
                    name = entry.name
                    if name.startswith("ref_") or name in deleted_in_folder:
                        continue
                    lower = name.lower()
                    if not (lower.endswith(".jpg") or lower.endswith(".jpeg") or lower.endswith(".png")):
                        continue

                    try:
                        stat = entry.stat()
                        # If entire month is older than cutoff, or mtime is older than cutoff
                        if m_end <= cutoff or stat.st_mtime < cutoff_epoch:
                            sz = stat.st_size
                            Path(entry.path).unlink(missing_ok=True)
                            total_deleted_files += 1
                            total_freed_bytes += sz
                    except OSError:
                        continue
            except Exception as e:
                logger.error("Error cleaning orphaned archive snapshots in %s: %s", snapshots_dir, e)

    if total_deleted_files > 0:
        invalidate_snapshot_cache()

    return total_deleted_files, total_freed_bytes, total_records_updated


def cleanup_archived_events(cutoff: datetime) -> Tuple[int, int, int]:
    """
    Clean up expired detection event records from all monthly archives on disk,
    including any associated snapshot image files.

    Parameters:
      cutoff: Cutoff datetime in UTC. Any event older than this is purged.

    Returns:
      Tuple of (deleted_files_count, freed_bytes, records_deleted_count)
    """
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)
    else:
        cutoff = cutoff.astimezone(timezone.utc)

    archive_dir = get_archive_dir()
    if not archive_dir.is_dir():
        return 0, 0, 0

    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    total_deleted_files = 0
    total_freed_bytes = 0
    total_records_deleted = 0

    for folder in sorted(archive_dir.iterdir()):
        if not folder.is_dir() or not MONTH_SLUG_REGEX.match(folder.name):
            continue

        slug = folder.name
        try:
            parts = slug.split("_")
            y, m = int(parts[0]), int(parts[1])
            m_start, m_end = get_month_date_range(y, m)
        except Exception:
            continue

        if m_start > cutoff:
            continue

        db_path = folder / f"events_{slug}.db"
        snapshots_dir = folder / "snapshots"

        if db_path.is_file():
            try:
                with sqlite3.connect(str(db_path)) as conn:
                    conn.execute("PRAGMA busy_timeout = 5000;")
                    cur = conn.cursor()

                    if m_end <= cutoff:
                        cur.execute("SELECT id, snapshot_path FROM events;")
                    else:
                        cur.execute(
                            "SELECT id, snapshot_path FROM events WHERE datetime(timestamp) < datetime(?);",
                            (cutoff_str,),
                        )

                    rows = cur.fetchall()
                    ids_to_delete = []

                    for row in rows:
                        ev_id, raw_snap = row[0], row[1]
                        ids_to_delete.append(ev_id)

                        if raw_snap and not raw_snap.startswith("ref_"):
                            safe_name = Path(raw_snap).name
                            if safe_name == raw_snap and ".." not in safe_name:
                                file_path = (snapshots_dir / safe_name).resolve()
                                if snapshots_dir.resolve() in file_path.parents and file_path.is_file():
                                    try:
                                        sz = file_path.stat().st_size
                                        file_path.unlink(missing_ok=True)
                                        total_deleted_files += 1
                                        total_freed_bytes += sz
                                    except OSError:
                                        pass

                    if ids_to_delete:
                        if m_end <= cutoff:
                            cur.execute("DELETE FROM events;")
                        else:
                            chunk_size = 500
                            for i in range(0, len(ids_to_delete), chunk_size):
                                chunk = ids_to_delete[i : i + chunk_size]
                                placeholders = ",".join("?" for _ in chunk)
                                cur.execute(
                                    f"DELETE FROM events WHERE id IN ({placeholders});",
                                    chunk,
                                )
                        conn.commit()
                        total_records_deleted += len(ids_to_delete)

                        try:
                            conn.execute("VACUUM;")
                        except Exception:
                            pass
            except Exception as e:
                logger.error("Error cleaning archived events in %s: %s", db_path, e)

    if total_deleted_files > 0:
        invalidate_snapshot_cache()

    return total_deleted_files, total_freed_bytes, total_records_deleted



