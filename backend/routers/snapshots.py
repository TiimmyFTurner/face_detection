"""
Snapshot serving API router.

Endpoints:
  GET /api/snapshots/{filename}  — Serve a cropped face snapshot image
"""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select

from backend.auth import decode_access_token
from backend.config import settings
from backend.database import get_db
from backend.models import User, Role

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])
bearer_scheme = HTTPBearer(auto_error=False)


@router.get("/{filename}")
async def get_snapshot(
    filename: str,
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    token_param: Optional[str] = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Serve a snapshot image file.

    Handles both event snapshots (from data/snapshots/) and
    reference photos (prefixed with 'ref_' from data/reference_photos/).
    Supervisors are strictly forbidden from viewing any photo or snapshot.
    """
    # Prevent path traversal attacks
    safe_name = Path(filename).name
    if safe_name != filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Check for authentication token to forbid supervisors
    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif token_param:
        token = token_param
    elif "access_token" in request.cookies:
        token = request.cookies.get("access_token")

    if token:
        payload = decode_access_token(token)
        if payload and payload.get("sub"):
            user_id = payload.get("sub")
            stmt = select(User).options(selectinload(User.role)).where(User.id == user_id)
            u_res = await db.execute(stmt)
            curr_user = u_res.scalar_one_or_none()
            if curr_user and curr_user.role and curr_user.role.name == "supervisor":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Supervisors are not permitted to view image snapshots or photos.",
                )

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
