"""
System configuration and runtime settings router.

Endpoints:
  GET   /api/settings                   — Get current runtime system settings
  PATCH /api/settings                   — Update runtime system settings
  GET   /api/settings/storage-stats     — Get storage disk usage and database event stats
  POST  /api/settings/cleanup-snapshots — On-demand snapshot disk cleanup
  POST  /api/settings/cleanup-logs      — On-demand database event logs cleanup
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, Query
from backend.auth import require_permission
from backend.config import settings
from backend.schemas import (
    SystemSettingsResponse,
    SystemSettingsUpdate,
    StorageStatsResponse,
    CleanupResponse,
)
from backend.snapshot_cleanup import (
    get_storage_stats,
    cleanup_old_snapshots,
    cleanup_old_events,
    update_env_file,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SystemSettingsResponse)
async def get_settings(
    _user=Depends(require_permission("settings:view")),
) -> SystemSettingsResponse:
    """Retrieve current system configuration, snapshot saving status, and retention windows."""
    return SystemSettingsResponse(
        save_snapshots=bool(settings.save_snapshots),
        log_unknown_faces=bool(getattr(settings, "log_unknown_faces", True)),
        match_threshold=float(settings.match_threshold),
        cooldown_seconds=int(settings.cooldown_seconds),
        frame_skip=int(settings.frame_skip),
        downscale_factor=float(settings.downscale_factor),
        snapshot_retention_days=int(getattr(settings, "snapshot_retention_days", 30)),
        event_log_retention_days=int(getattr(settings, "event_log_retention_days", 0)),
        roi_crop_enabled=bool(getattr(settings, "roi_crop_enabled", True)),
        live_preview_fps=float(getattr(settings, "live_preview_fps", 1.0)),
        duty_cycle_window=float(getattr(settings, "duty_cycle_window", 30.0)),
        duty_burst_duration=float(getattr(settings, "duty_burst_duration", 2.0)),
        max_reconnect_backoff=int(getattr(settings, "max_reconnect_backoff", 30)),
    )


@router.patch("", response_model=SystemSettingsResponse)
async def update_settings(
    update_data: SystemSettingsUpdate,
    _user=Depends(require_permission("settings:edit")),
) -> SystemSettingsResponse:
    """
    Update runtime system configuration on the fly without restarting the server.
    Also persists changes to the .env file for continuity across restarts.
    """
    env_updates = {}

    if update_data.save_snapshots is not None:
        settings.save_snapshots = update_data.save_snapshots
        env_updates["SAVE_SNAPSHOTS"] = str(update_data.save_snapshots)
        logger.info("Setting 'save_snapshots' updated to: %s", settings.save_snapshots)

    if update_data.log_unknown_faces is not None:
        settings.log_unknown_faces = update_data.log_unknown_faces
        env_updates["LOG_UNKNOWN_FACES"] = str(update_data.log_unknown_faces)
        logger.info("Setting 'log_unknown_faces' updated to: %s", settings.log_unknown_faces)

    if update_data.match_threshold is not None:
        settings.match_threshold = max(0.1, min(1.0, update_data.match_threshold))
        env_updates["MATCH_THRESHOLD"] = str(settings.match_threshold)
        logger.info("Setting 'match_threshold' updated to: %.2f", settings.match_threshold)

    if update_data.cooldown_seconds is not None:
        settings.cooldown_seconds = max(1, update_data.cooldown_seconds)
        env_updates["COOLDOWN_SECONDS"] = str(settings.cooldown_seconds)
        logger.info("Setting 'cooldown_seconds' updated to: %d", settings.cooldown_seconds)

    if update_data.frame_skip is not None:
        settings.frame_skip = max(1, update_data.frame_skip)
        env_updates["FRAME_SKIP"] = str(settings.frame_skip)
        logger.info("Setting 'frame_skip' updated to: %d", settings.frame_skip)

    if update_data.downscale_factor is not None:
        settings.downscale_factor = max(0.1, min(1.0, update_data.downscale_factor))
        env_updates["DOWNSCALE_FACTOR"] = str(settings.downscale_factor)
        logger.info("Setting 'downscale_factor' updated to: %.2f", settings.downscale_factor)

    if update_data.snapshot_retention_days is not None:
        settings.snapshot_retention_days = max(0, update_data.snapshot_retention_days)
        env_updates["SNAPSHOT_RETENTION_DAYS"] = str(settings.snapshot_retention_days)
        logger.info("Setting 'snapshot_retention_days' updated to: %d", settings.snapshot_retention_days)

    if update_data.event_log_retention_days is not None:
        settings.event_log_retention_days = max(0, update_data.event_log_retention_days)
        env_updates["EVENT_LOG_RETENTION_DAYS"] = str(settings.event_log_retention_days)
        logger.info("Setting 'event_log_retention_days' updated to: %d", settings.event_log_retention_days)

    if update_data.roi_crop_enabled is not None:
        settings.roi_crop_enabled = bool(update_data.roi_crop_enabled)
        env_updates["ROI_CROP_ENABLED"] = str(settings.roi_crop_enabled)
        logger.info("Setting 'roi_crop_enabled' updated to: %s", settings.roi_crop_enabled)

    if update_data.live_preview_fps is not None:
        settings.live_preview_fps = max(0.1, min(10.0, float(update_data.live_preview_fps)))
        env_updates["LIVE_PREVIEW_FPS"] = str(settings.live_preview_fps)
        logger.info("Setting 'live_preview_fps' updated to: %.1f", settings.live_preview_fps)

    if update_data.duty_cycle_window is not None:
        settings.duty_cycle_window = max(5.0, min(300.0, float(update_data.duty_cycle_window)))
        env_updates["DUTY_CYCLE_WINDOW"] = str(settings.duty_cycle_window)
        logger.info("Setting 'duty_cycle_window' updated to: %.1f", settings.duty_cycle_window)

    if update_data.duty_burst_duration is not None:
        settings.duty_burst_duration = max(1.0, min(60.0, float(update_data.duty_burst_duration)))
        env_updates["DUTY_BURST_DURATION"] = str(settings.duty_burst_duration)
        logger.info("Setting 'duty_burst_duration' updated to: %.1f", settings.duty_burst_duration)

    if update_data.max_reconnect_backoff is not None:
        settings.max_reconnect_backoff = max(5, min(120, int(update_data.max_reconnect_backoff)))
        env_updates["MAX_RECONNECT_BACKOFF"] = str(settings.max_reconnect_backoff)
        logger.info("Setting 'max_reconnect_backoff' updated to: %d", settings.max_reconnect_backoff)

    if env_updates:
        update_env_file(env_updates)

    return SystemSettingsResponse(
        save_snapshots=bool(settings.save_snapshots),
        log_unknown_faces=bool(getattr(settings, "log_unknown_faces", True)),
        match_threshold=float(settings.match_threshold),
        cooldown_seconds=int(settings.cooldown_seconds),
        frame_skip=int(settings.frame_skip),
        downscale_factor=float(settings.downscale_factor),
        snapshot_retention_days=int(getattr(settings, "snapshot_retention_days", 30)),
        event_log_retention_days=int(getattr(settings, "event_log_retention_days", 0)),
        roi_crop_enabled=bool(getattr(settings, "roi_crop_enabled", True)),
        live_preview_fps=float(getattr(settings, "live_preview_fps", 1.0)),
        duty_cycle_window=float(getattr(settings, "duty_cycle_window", 30.0)),
        duty_burst_duration=float(getattr(settings, "duty_burst_duration", 2.0)),
        max_reconnect_backoff=int(getattr(settings, "max_reconnect_backoff", 30)),
    )


@router.get("/storage-stats", response_model=StorageStatsResponse)
async def get_system_storage_stats(
    _user=Depends(require_permission("settings:view")),
) -> StorageStatsResponse:
    """
    Retrieve snapshot storage disk usage statistics (file count, total size in MB/bytes)
    and database event log counts.
    """
    stats = await get_storage_stats()
    return StorageStatsResponse(**stats)


@router.post("/cleanup-snapshots", response_model=CleanupResponse)
async def trigger_snapshot_cleanup(
    retention_days: Optional[int] = Query(None, ge=0, description="Override retention days (default: configured setting)"),
    _user=Depends(require_permission("settings:edit")),
) -> CleanupResponse:
    """
    Trigger immediate on-demand cleanup of snapshot image files on disk.
    Deletes files older than specified or configured retention days and clears snapshot references in DB.
    """
    res = await cleanup_old_snapshots(retention_days=retention_days)
    return CleanupResponse(**res)


@router.post("/cleanup-logs", response_model=CleanupResponse)
async def trigger_event_logs_cleanup(
    retention_days: Optional[int] = Query(None, ge=0, description="Override retention days (default: configured setting)"),
    _user=Depends(require_permission("settings:edit")),
) -> CleanupResponse:
    """
    Trigger immediate on-demand cleanup of historical detection events from the database.
    Deletes events older than specified or configured retention days and their associated snapshots.
    """
    res = await cleanup_old_events(retention_days=retention_days)
    return CleanupResponse(**res)

