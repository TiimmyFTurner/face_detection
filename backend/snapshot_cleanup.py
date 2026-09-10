"""
Snapshot and Event Log Retention & Storage Management Service.

Provides:
  - Automatic & on-demand deletion of expired snapshot image files from disk.
  - Automatic & on-demand deletion of expired event log records from database.
  - Disk storage calculations (file counts, size in MB/GB, timestamp ranges).
  - Background periodic retention worker.
  - Helper to persist updated settings to .env file.
"""

import asyncio
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, Dict, Any

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import async_session
from backend.models import Event

logger = logging.getLogger(__name__)


def update_env_file(updates: Dict[str, Any], env_path: Optional[Path] = None) -> bool:
    """
    Safely update or append KEY=VALUE settings in the .env file
    so runtime modifications survive server restarts.
    """
    if env_path is None:
        env_path = Path(".env")

    try:
        lines = []
        if env_path.exists():
            lines = env_path.read_text(encoding="utf-8").splitlines()

        updated_keys = set()
        new_lines = []

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("#") or "=" not in stripped:
                new_lines.append(line)
                continue

            key = stripped.split("=", 1)[0].strip()
            key_upper = key.upper()

            # Match against update keys
            matched_key = None
            for u_key in updates:
                if u_key.upper() == key_upper:
                    matched_key = u_key
                    break

            if matched_key:
                val = updates[matched_key]
                new_lines.append(f"{key}={val}")
                updated_keys.add(matched_key.upper())
            else:
                new_lines.append(line)

        # Append keys that were not in the file
        for u_key, val in updates.items():
            if u_key.upper() not in updated_keys:
                new_lines.append(f"{u_key.upper()}={val}")

        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        logger.info(".env updated with: %s", list(updates.keys()))
        return True
    except Exception as e:
        logger.warning("Failed to update .env file: %s", e)
        return False


def get_storage_stats_sync() -> Dict[str, Any]:
    """
    Calculate disk usage of the snapshots directory synchronously.
    """
    snap_dir = Path(settings.snapshot_dir)
    total_files = 0
    total_bytes = 0
    oldest_ts: Optional[float] = None
    newest_ts: Optional[float] = None

    if snap_dir.exists() and snap_dir.is_dir():
        for entry in os.scandir(snap_dir):
            if not entry.is_file():
                continue
            name = entry.name.lower()
            # Must be an image file and not a reference photo
            if name.startswith("ref_"):
                continue
            if not (name.endswith(".jpg") or name.endswith(".jpeg") or name.endswith(".png")):
                continue

            try:
                stat = entry.stat()
                total_files += 1
                total_bytes += stat.st_size
                mtime = stat.st_mtime

                if oldest_ts is None or mtime < oldest_ts:
                    oldest_ts = mtime
                if newest_ts is None or mtime > newest_ts:
                    newest_ts = mtime
            except OSError:
                continue

    oldest_dt_str = (
        datetime.fromtimestamp(oldest_ts, tz=timezone.utc).isoformat()
        if oldest_ts
        else None
    )
    newest_dt_str = (
        datetime.fromtimestamp(newest_ts, tz=timezone.utc).isoformat()
        if newest_ts
        else None
    )

    return {
        "snapshot_count": total_files,
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / (1024 * 1024), 2),
        "oldest_snapshot_date": oldest_dt_str,
        "newest_snapshot_date": newest_dt_str,
    }


async def get_storage_stats(session_factory=None) -> Dict[str, Any]:
    """
    Fetch comprehensive snapshot storage stats from disk and event log stats from DB.
    """
    loop = asyncio.get_running_loop()
    disk_stats = await loop.run_in_executor(None, get_storage_stats_sync)

    factory = session_factory or async_session
    event_count = 0
    oldest_ev_str = None
    newest_ev_str = None

    try:
        async with factory() as session:
            count_q = select(func.count(Event.id))
            c_res = await session.execute(count_q)
            event_count = c_res.scalar() or 0

            if event_count > 0:
                min_q = select(func.min(Event.timestamp))
                min_res = await session.execute(min_q)
                min_val = min_res.scalar()
                if min_val:
                    if min_val.tzinfo is None:
                        min_val = min_val.replace(tzinfo=timezone.utc)
                    oldest_ev_str = min_val.isoformat()

                max_q = select(func.max(Event.timestamp))
                max_res = await session.execute(max_q)
                max_val = max_res.scalar()
                if max_val:
                    if max_val.tzinfo is None:
                        max_val = max_val.replace(tzinfo=timezone.utc)
                    newest_ev_str = max_val.isoformat()
    except Exception as e:
        logger.warning("Failed to query DB event stats: %s", e)

    return {
        **disk_stats,
        "event_count": event_count,
        "oldest_event_date": oldest_ev_str,
        "newest_event_date": newest_ev_str,
    }


async def cleanup_old_snapshots(
    retention_days: Optional[int] = None,
    session_factory=None,
) -> Dict[str, Any]:
    """
    Delete snapshot image files older than retention_days.
    Clears the snapshot_path in corresponding database Event rows (setting to "")
    so event records remain intact without dead image links.
    Also cleans orphaned images in snapshot_dir older than cutoff.

    If retention_days <= 0, no snapshots are deleted (No Expiry mode).
    """
    days = (
        retention_days
        if retention_days is not None
        else getattr(settings, "snapshot_retention_days", 0)
    )

    if days <= 0:
        return {
            "success": True,
            "deleted_files": 0,
            "freed_bytes": 0,
            "freed_mb": 0.0,
            "records_removed": 0,
            "message": "Snapshot retention is disabled (No Expiry / Keep Forever).",
        }

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    snap_dir = Path(settings.snapshot_dir).resolve()

    deleted_files = 0
    freed_bytes = 0
    records_updated = 0
    deleted_paths = set()

    factory = session_factory or async_session

    try:
        async with factory() as session:
            stmt = select(Event).where(
                and_(
                    Event.timestamp < cutoff,
                    Event.snapshot_path != "",
                    Event.snapshot_path.isnot(None),
                )
            )
            res = await session.execute(stmt)
            events_to_clean = res.scalars().all()

            for event in events_to_clean:
                raw_filename = event.snapshot_path
                # Safety check: avoid reference photos and traversal
                if not raw_filename or raw_filename.startswith("ref_"):
                    continue
                safe_name = Path(raw_filename).name
                if safe_name != raw_filename or ".." in raw_filename:
                    continue

                file_path = (snap_dir / safe_name).resolve()
                # Verify file is strictly inside snapshot_dir
                if snap_dir in file_path.parents and file_path.is_file():
                    try:
                        sz = file_path.stat().st_size
                        file_path.unlink(missing_ok=True)
                        deleted_files += 1
                        freed_bytes += sz
                        deleted_paths.add(safe_name)
                    except OSError as e:
                        logger.warning("Could not delete snapshot file %s: %s", file_path, e)

                event.snapshot_path = ""
                records_updated += 1

            if records_updated > 0:
                await session.commit()
    except Exception as e:
        logger.error("Error during DB snapshot cleanup: %s", e)

    # Clean orphaned image files on disk older than cutoff
    try:
        cutoff_epoch = cutoff.timestamp()
        if snap_dir.exists() and snap_dir.is_dir():
            for entry in os.scandir(snap_dir):
                if not entry.is_file():
                    continue
                name = entry.name
                if name.startswith("ref_") or name in deleted_paths:
                    continue
                lower = name.lower()
                if not (lower.endswith(".jpg") or lower.endswith(".jpeg") or lower.endswith(".png")):
                    continue

                try:
                    stat = entry.stat()
                    if stat.st_mtime < cutoff_epoch:
                        sz = stat.st_size
                        Path(entry.path).unlink(missing_ok=True)
                        deleted_files += 1
                        freed_bytes += sz
                        deleted_paths.add(name)
                except OSError:
                    continue
    except Exception as e:
        logger.error("Error during orphaned snapshot cleanup: %s", e)

    freed_mb = round(freed_bytes / (1024 * 1024), 2)
    logger.info(
        "Snapshot cleanup finished: deleted %d files, freed %.2f MB, cleared %d DB event snapshot references (retention=%d days).",
        deleted_files,
        freed_mb,
        records_updated,
        days,
    )

    return {
        "success": True,
        "deleted_files": deleted_files,
        "freed_bytes": freed_bytes,
        "freed_mb": freed_mb,
        "records_removed": records_updated,
        "message": f"Successfully deleted {deleted_files} old snapshots and freed {freed_mb} MB.",
    }


async def cleanup_old_events(
    retention_days: Optional[int] = None,
    session_factory=None,
) -> Dict[str, Any]:
    """
    Delete detection event records older than retention_days from the database.
    Also deletes any associated snapshot images from disk if still present.

    If retention_days <= 0, no events are deleted (No Expiry mode).
    """
    days = (
        retention_days
        if retention_days is not None
        else getattr(settings, "event_log_retention_days", 0)
    )

    if days <= 0:
        return {
            "success": True,
            "deleted_files": 0,
            "freed_bytes": 0,
            "freed_mb": 0.0,
            "records_removed": 0,
            "message": "Event log retention is disabled (No Expiry / Keep Forever).",
        }

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    snap_dir = Path(settings.snapshot_dir).resolve()

    deleted_files = 0
    freed_bytes = 0
    records_deleted = 0

    factory = session_factory or async_session

    try:
        async with factory() as session:
            stmt = select(Event).where(Event.timestamp < cutoff)
            res = await session.execute(stmt)
            events_to_delete = res.scalars().all()

            for event in events_to_delete:
                # Remove associated snapshot file if exists
                if event.snapshot_path and not event.snapshot_path.startswith("ref_"):
                    safe_name = Path(event.snapshot_path).name
                    if safe_name == event.snapshot_path and ".." not in safe_name:
                        file_path = (snap_dir / safe_name).resolve()
                        if snap_dir in file_path.parents and file_path.is_file():
                            try:
                                sz = file_path.stat().st_size
                                file_path.unlink(missing_ok=True)
                                deleted_files += 1
                                freed_bytes += sz
                            except OSError:
                                pass

                await session.delete(event)
                records_deleted += 1

            if records_deleted > 0:
                await session.commit()
    except Exception as e:
        logger.error("Error during DB event logs cleanup: %s", e)
        return {
            "success": False,
            "deleted_files": deleted_files,
            "freed_bytes": freed_bytes,
            "freed_mb": round(freed_bytes / (1024 * 1024), 2),
            "records_removed": records_deleted,
            "message": f"Event log cleanup encountered an error: {e}",
        }

    freed_mb = round(freed_bytes / (1024 * 1024), 2)
    logger.info(
        "Event logs cleanup finished: deleted %d records from DB and %d associated snapshot files (freed %.2f MB, retention=%d days).",
        records_deleted,
        deleted_files,
        freed_mb,
        days,
    )

    return {
        "success": True,
        "deleted_files": deleted_files,
        "freed_bytes": freed_bytes,
        "freed_mb": freed_mb,
        "records_removed": records_deleted,
        "message": f"Successfully deleted {records_deleted} old event logs ({deleted_files} files removed, {freed_mb} MB freed).",
    }


class RetentionWorker:
    """
    Background worker that runs hourly to automatically clean up
    expired snapshots and event logs.
    """

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running: bool = False

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Retention worker started.")

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Retention worker stopped.")

    async def _run_loop(self) -> None:
        # Initial wait of 30 seconds after startup before first check
        await asyncio.sleep(30)
        while self._running:
            try:
                snap_days = getattr(settings, "snapshot_retention_days", 0)
                if snap_days > 0:
                    logger.info("Running automatic snapshot retention check (%d days)...", snap_days)
                    await cleanup_old_snapshots(snap_days)

                log_days = getattr(settings, "event_log_retention_days", 0)
                if log_days > 0:
                    logger.info("Running automatic event log retention check (%d days)...", log_days)
                    await cleanup_old_events(log_days)
            except Exception as e:
                logger.error("Unexpected error in retention worker: %s", e)

            # Wait configured interval (default 1 hour)
            interval_hours = max(0.1, getattr(settings, "snapshot_cleanup_interval_hours", 1.0))
            await asyncio.sleep(interval_hours * 3600)


# Singleton retention worker instance
retention_worker = RetentionWorker()
