"""
Break Presets Router — Reusable Lunch and Free Time Breaks Management.
Provides CRUD endpoints for defining and managing lunch, tea, rest, and prayer
break presets shared across Workstation Zones and Person Shift Timetables.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import require_any_permission
from backend.database import get_db
from backend.models import BreakPreset
from backend.schemas import BreakPresetCreate, BreakPresetResponse, BreakPresetUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/break-presets", tags=["break-presets"])


@router.get("", response_model=list[BreakPresetResponse])
async def list_break_presets(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("zones:view", "persons:view", "duty:view", "dashboard:view", "users:view")),
):
    """List all available lunch and free time presets."""
    result = await db.execute(select(BreakPreset).order_by(BreakPreset.start_time.asc(), BreakPreset.id.asc()))
    return result.scalars().all()


@router.post("", response_model=BreakPresetResponse, status_code=status.HTTP_201_CREATED)
async def create_break_preset(
    data: BreakPresetCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("zones:create", "zones:edit", "persons:edit", "duty:manage")),
):
    """Create a new reusable lunch or free time preset."""
    # Validate time format
    try:
        sh, sm = map(int, data.start_time.split(":"))
        eh, em = map(int, data.end_time.split(":"))
        if not (0 <= sh <= 23 and 0 <= sm <= 59 and 0 <= eh <= 23 and 0 <= em <= 59):
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid time format. Expected HH:MM between 00:00 and 23:59")

    # Pick default icon based on category/name if not provided
    icon = data.icon or "☕"
    name_lower = data.name.lower()
    if not data.icon or data.icon == "☕" or data.icon == "🍽️":
        if "ناهار" in data.name or "lunch" in name_lower or data.category == "lunch":
            icon = "🍽️"
        elif "نماز" in data.name or "prayer" in name_lower:
            icon = "🕌"
        elif "چای" in data.name or "عصرانه" in data.name or "tea" in name_lower:
            icon = "☕"
        elif "شب" in data.name or "night" in name_lower or "midnight" in name_lower:
            icon = "🌙"
        elif "صبحانه" in data.name or "breakfast" in name_lower:
            icon = "🍳"

    preset = BreakPreset(
        name=data.name.strip(),
        start_time=data.start_time.strip(),
        end_time=data.end_time.strip(),
        category=data.category or "lunch",
        icon=icon,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    logger.info("Created break preset '%s' (%s - %s)", preset.name, preset.start_time, preset.end_time)
    return preset


@router.get("/{preset_id}", response_model=BreakPresetResponse)
async def get_break_preset(
    preset_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("zones:view", "persons:view", "duty:view")),
):
    """Get a specific break preset by ID."""
    preset = await db.get(BreakPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Break preset not found")
    return preset


@router.put("/{preset_id}", response_model=BreakPresetResponse)
async def update_break_preset(
    preset_id: int,
    data: BreakPresetUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("zones:edit", "persons:edit", "duty:manage")),
):
    """Update an existing break preset."""
    preset = await db.get(BreakPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Break preset not found")

    if data.name is not None:
        preset.name = data.name.strip()
    if data.start_time is not None:
        preset.start_time = data.start_time.strip()
    if data.end_time is not None:
        preset.end_time = data.end_time.strip()
    if data.category is not None:
        preset.category = data.category
    if data.icon is not None:
        preset.icon = data.icon

    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_break_preset(
    preset_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("zones:delete", "zones:edit", "persons:edit", "duty:manage")),
):
    """Delete a break preset."""
    preset = await db.get(BreakPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Break preset not found")

    await db.delete(preset)
    await db.commit()
    logger.info("Deleted break preset #%d (%s)", preset_id, preset.name)
