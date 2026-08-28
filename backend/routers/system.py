"""
System configuration and runtime settings router.

Endpoints:
  GET   /api/settings — Get current runtime system settings
  PATCH /api/settings — Update runtime system settings (e.g. save_snapshots toggle)
"""

import logging
from fastapi import APIRouter
from backend.config import settings
from backend.schemas import SystemSettingsResponse, SystemSettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SystemSettingsResponse)
async def get_settings() -> SystemSettingsResponse:
    """Retrieve current system configuration and snapshot saving status."""
    return SystemSettingsResponse(
        save_snapshots=bool(settings.save_snapshots),
        log_unknown_faces=bool(getattr(settings, "log_unknown_faces", True)),
        match_threshold=float(settings.match_threshold),
        cooldown_seconds=int(settings.cooldown_seconds),
        frame_skip=int(settings.frame_skip),
        downscale_factor=float(settings.downscale_factor),
    )


@router.patch("", response_model=SystemSettingsResponse)
async def update_settings(update_data: SystemSettingsUpdate) -> SystemSettingsResponse:
    """
    Update runtime system configuration on the fly without restarting the server.
    """
    if update_data.save_snapshots is not None:
        settings.save_snapshots = update_data.save_snapshots
        logger.info("Setting 'save_snapshots' updated to: %s", settings.save_snapshots)

    if update_data.log_unknown_faces is not None:
        settings.log_unknown_faces = update_data.log_unknown_faces
        logger.info("Setting 'log_unknown_faces' updated to: %s", settings.log_unknown_faces)

    if update_data.match_threshold is not None:
        settings.match_threshold = max(0.1, min(1.0, update_data.match_threshold))
        logger.info("Setting 'match_threshold' updated to: %.2f", settings.match_threshold)

    if update_data.cooldown_seconds is not None:
        settings.cooldown_seconds = max(1, update_data.cooldown_seconds)
        logger.info("Setting 'cooldown_seconds' updated to: %d", settings.cooldown_seconds)

    if update_data.frame_skip is not None:
        settings.frame_skip = max(1, update_data.frame_skip)
        logger.info("Setting 'frame_skip' updated to: %d", settings.frame_skip)

    if update_data.downscale_factor is not None:
        settings.downscale_factor = max(0.1, min(1.0, update_data.downscale_factor))
        logger.info("Setting 'downscale_factor' updated to: %.2f", settings.downscale_factor)

    return SystemSettingsResponse(
        save_snapshots=bool(settings.save_snapshots),
        log_unknown_faces=bool(getattr(settings, "log_unknown_faces", True)),
        match_threshold=float(settings.match_threshold),
        cooldown_seconds=int(settings.cooldown_seconds),
        frame_skip=int(settings.frame_skip),
        downscale_factor=float(settings.downscale_factor),
    )
