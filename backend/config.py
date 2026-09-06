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

    # ── Server ───────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000

    def ensure_directories(self) -> None:
        """Create required data directories if they don't exist."""
        Path(self.snapshot_dir).mkdir(parents=True, exist_ok=True)
        Path(self.reference_photo_dir).mkdir(parents=True, exist_ok=True)
        # Ensure the database parent directory exists
        db_path = self.database_url.split("///")[-1] if "///" in self.database_url else None
        if db_path:
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)


# Singleton settings instance
settings = Settings()
