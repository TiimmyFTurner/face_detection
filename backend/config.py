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
    insightface_model: str = "buffalo_l"

    # ── Stream Processing ────────────────────────────────
    frame_skip: int = 5
    downscale_factor: float = 0.5
    cooldown_seconds: int = 60
    max_reconnect_backoff: int = 30

    # ── Storage ──────────────────────────────────────────
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
