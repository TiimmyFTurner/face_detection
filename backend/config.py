"""
Application configuration via environment variables.
Uses pydantic-settings to load from .env file with sensible defaults.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    """Central configuration for the Face Tracking & Logging System."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Database ──────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./data/face_tracking.db"

    # ── Face Recognition ─────────────────────────────────
    match_threshold: float = 0.5
    insightface_model: str = "buffalo_s"  # buffalo_s is lightweight & 10x faster for multi-camera stations
    log_unknown_faces: bool = True  # If False, unidentified/unknown faces are ignored and not logged

    # ── Stream Processing & Duty Cycle Optimization ──────
    frame_skip: int = 5
    downscale_factor: float = 0.5
    cooldown_seconds: int = 60
    max_reconnect_backoff: int = 30

    # 2s burst every 30s duty cycle monitoring
    duty_cycle_window: float = 30.0    # Total cycle duration in seconds (e.g. 30s)
    duty_burst_duration: float = 2.0   # Active detection burst in seconds (e.g. 2s)
    duty_stagger_cameras: bool = True  # Stagger detection bursts so cameras don't spike simultaneously
    roi_crop_enabled: bool = True      # Crop to station zone ROI before detection to save 70-85% pixels
    live_preview_fps: float = 1.0      # Throttle JPEG compression for live dashboard previews (max 1 FPS per cam)

    # ── Storage ──────────────────────────────────────────
    save_snapshots: bool = True  # If False, events are only logged to DB without saving snapshot files to disk
    snapshot_dir: str = "./data/snapshots"
    reference_photo_dir: str = "./data/reference_photos"
    snapshot_retention_days: int = 30  # 0 = No expiry (keep forever). Otherwise delete snapshot files older than N days.
    event_log_retention_days: int = 0  # 0 = No expiry (keep forever). Otherwise delete event records older than N days.
    snapshot_cleanup_interval_hours: int = 1  # Frequency of background retention worker in hours

    archive_dir: str = "./data/archives"
    auto_archive_monthly: bool = True  # Automatically archive completed previous month on 1st of month
    archive_purge_active: bool = True  # Delete archived events from active DB to free space

    # ── Server ───────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000

    def get_effective_archive_dir(self) -> Path:
        """
        Resolve the effective Path for the monthly archive directory.
        If a custom path or external drive is configured via ARCHIVE_DIR, it is resolved directly.
        If archive_dir is default/unspecified and snapshot_dir is on a custom path, archives are
        stored alongside snapshots in that custom location rather than in the application directory.
        """
        raw = getattr(self, "archive_dir", None)
        clean = str(raw).strip().strip('"\'') if raw else ""
        if not clean or clean.replace("\\", "/").rstrip("/") == "./data/archives":
            snap_raw = getattr(self, "snapshot_dir", "./data/snapshots")
            snap_clean = str(snap_raw).strip().strip('"\'')
            if snap_clean and snap_clean.replace("\\", "/").rstrip("/") != "./data/snapshots":
                return (Path(snap_clean).parent / "archives").resolve()
        target = clean if clean else "./data/archives"
        return Path(target).resolve()

    def ensure_directories(self) -> None:
        """Create required data directories if they don't exist."""
        clean_snap = str(self.snapshot_dir).strip().strip('"\'')
        clean_ref = str(self.reference_photo_dir).strip().strip('"\'')
        Path(clean_snap).resolve().mkdir(parents=True, exist_ok=True)
        Path(clean_ref).resolve().mkdir(parents=True, exist_ok=True)
        self.get_effective_archive_dir().mkdir(parents=True, exist_ok=True)
        # Ensure the database parent directory exists
        db_path = self.database_url.split("///")[-1] if "///" in self.database_url else None
        if db_path:
            clean_db = str(db_path).strip().strip('"\'')
            Path(clean_db).parent.resolve().mkdir(parents=True, exist_ok=True)


# Singleton settings instance
settings = Settings()
