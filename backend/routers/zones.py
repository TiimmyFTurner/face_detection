"""
Camera Zone / Important Area management API router.

Endpoints:
  GET    /api/cameras/{camera_id}/zones — List zones for a camera
  POST   /api/cameras/{camera_id}/zones — Create a new zone on a camera
  GET    /api/zones                     — List all zones across cameras
  GET    /api/zones/{zone_id}           — Get details for a zone
  PUT    /api/zones/{zone_id}           — Update a zone
  DELETE /api/zones/{zone_id}           — Remove a zone
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import Camera, CameraZone
from backend.schemas import CameraZoneCreate, CameraZoneUpdate, CameraZoneResponse
from backend.stream_processor import stream_processor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["zones"])


# ── Camera-Scoped Endpoints ──────────────────────────────

@router.get("/api/cameras/{camera_id}/zones", response_model=list[CameraZoneResponse])
async def list_camera_zones(camera_id: int, db: AsyncSession = Depends(get_db)):
    """List all important areas/zones defined on a specific camera."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    result = await db.execute(
        select(CameraZone)
        .where(CameraZone.camera_id == camera_id)
        .order_by(CameraZone.created_at.asc())
    )
    return result.scalars().all()


@router.post("/api/cameras/{camera_id}/zones", response_model=CameraZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_camera_zone(
    camera_id: int,
    data: CameraZoneCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new important area/zone on a camera and attach persons."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    zone = CameraZone(
        camera_id=camera_id,
        name=data.name,
        x=data.x,
        y=data.y,
        width=data.width,
        height=data.height,
        alert_mode=data.alert_mode,
        assigned_person_ids=data.assigned_person_ids,
        is_active=data.is_active,
    )
    db.add(zone)
    await db.commit()
    await db.refresh(zone)

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    logger.info("Camera zone created: id=%d camera_id=%d name='%s'", zone.id, camera_id, zone.name)
    return zone


# ── Direct Zone Endpoints ────────────────────────────────

@router.get("/api/zones", response_model=list[CameraZoneResponse])
async def list_all_zones(db: AsyncSession = Depends(get_db)):
    """List all defined camera zones across the system."""
    result = await db.execute(select(CameraZone).order_by(CameraZone.created_at.desc()))
    return result.scalars().all()


@router.get("/api/zones/{zone_id}", response_model=CameraZoneResponse)
async def get_zone(zone_id: int, db: AsyncSession = Depends(get_db)):
    """Get details for a specific camera zone."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


@router.put("/api/zones/{zone_id}", response_model=CameraZoneResponse)
async def update_zone(
    zone_id: int,
    data: CameraZoneUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a camera zone's coordinates, name, assigned persons, or alert mode."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    if data.name is not None:
        zone.name = data.name
    if data.x is not None:
        zone.x = data.x
    if data.y is not None:
        zone.y = data.y
    if data.width is not None:
        zone.width = data.width
    if data.height is not None:
        zone.height = data.height
    if data.alert_mode is not None:
        zone.alert_mode = data.alert_mode
    if data.assigned_person_ids is not None:
        zone.assigned_person_ids = data.assigned_person_ids
    if data.is_active is not None:
        zone.is_active = data.is_active

    await db.commit()
    await db.refresh(zone)

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    return zone


@router.delete("/api/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zone(zone_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a camera zone."""
    zone = await db.get(CameraZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    await db.delete(zone)
    await db.commit()

    # Refresh stream processor zone cache
    await stream_processor.refresh_zones()

    logger.info("Camera zone deleted: id=%d", zone_id)
