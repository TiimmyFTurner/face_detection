"""
Snapshot serving API router.

Endpoints:
  GET /api/snapshots/{filename}  — Serve a cropped face snapshot image
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.config import settings

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


@router.get("/{filename}")
async def get_snapshot(filename: str):
    """
    Serve a snapshot image file.

    Handles both event snapshots (from data/snapshots/) and
    reference photos (prefixed with 'ref_' from data/reference_photos/).
    """
    # Prevent path traversal attacks
    safe_name = Path(filename).name
    if safe_name != filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Check if it's a reference photo
    if filename.startswith("ref_"):
        actual_name = filename[4:]  # Remove 'ref_' prefix
        file_path = Path(settings.reference_photo_dir) / actual_name
    else:
        file_path = Path(settings.snapshot_dir) / safe_name

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    return FileResponse(
        path=str(file_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )
