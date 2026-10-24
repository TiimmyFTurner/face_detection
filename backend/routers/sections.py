"""
Sections Router — Factory Section / Department Management.
Provides CRUD endpoints for defining facility areas (e.g. Packaging, Warehouse, Assembly)
and monitoring camera, person, and supervisor counts for each section.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import require_any_permission, require_permission
from backend.database import get_db
from backend.models import Camera, Person, Section, User
from backend.schemas import SectionCreate, SectionResponse, SectionUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sections", tags=["sections"])


async def _enrich_section(section: Section, db: AsyncSession) -> SectionResponse:
    """Compute camera, person, and supervisor counts for a given section."""
    cam_count = await db.scalar(
        select(func.count(Camera.id)).where(Camera.section == section.name)
    ) or 0

    per_count = await db.scalar(
        select(func.count(Person.id)).where(Person.section == section.name)
    ) or 0

    # Supervisors count: users whose assigned_sections JSON contains section.name
    # Since assigned_sections is JSON list, we can check in Python or SQLite json_each
    all_users_res = await db.execute(select(User))
    all_users = all_users_res.scalars().all()
    sup_count = 0
    for u in all_users:
        user_secs = u.assigned_sections or []
        if section.name in user_secs:
            sup_count += 1

    return SectionResponse(
        id=section.id,
        name=section.name,
        description=section.description or "",
        camera_count=cam_count,
        person_count=per_count,
        supervisor_count=sup_count,
        created_at=section.created_at,
        updated_at=section.updated_at,
    )


@router.get("", response_model=list[SectionResponse])
async def list_sections(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("sections:view", "users:view", "dashboard:view", "cameras:view", "persons:view")),
):
    """List all configured factory sections with resource counts."""
    res = await db.execute(select(Section).order_by(Section.name.asc()))
    sections = res.scalars().all()
    return [await _enrich_section(s, db) for s in sections]


@router.post("", response_model=SectionResponse, status_code=status.HTTP_201_CREATED)
async def create_section(
    data: SectionCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("sections:manage", "users:manage")),
):
    """Create a new factory section."""
    name = data.name.strip()
    existing = await db.scalar(select(Section).where(Section.name == name))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"بخش '{name}' از قبل وجود دارد.",
        )

    sec = Section(name=name, description=(data.description or "").strip())
    db.add(sec)
    await db.commit()
    await db.refresh(sec)
    logger.info("Created section '%s' (id=%d)", sec.name, sec.id)
    return await _enrich_section(sec, db)


@router.get("/{section_id}", response_model=SectionResponse)
async def get_section(
    section_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("sections:view", "users:view")),
):
    """Get section details."""
    sec = await db.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="بخش یافت نشد.")
    return await _enrich_section(sec, db)


@router.put("/{section_id}", response_model=SectionResponse)
async def update_section(
    section_id: int,
    data: SectionUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("sections:manage", "users:manage")),
):
    """Update section name and description, cascading name changes to cameras and persons."""
    sec = await db.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="بخش یافت نشد.")

    old_name = sec.name
    if data.name is not None:
        new_name = data.name.strip()
        if new_name != old_name:
            dup = await db.scalar(select(Section).where(Section.name == new_name, Section.id != section_id))
            if dup:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="بخشی با این نام از قبل وجود دارد.")
            sec.name = new_name

            # Cascade name to cameras and persons
            cam_res = await db.execute(select(Camera).where(Camera.section == old_name))
            for cam in cam_res.scalars().all():
                cam.section = new_name

            per_res = await db.execute(select(Person).where(Person.section == old_name))
            for per in per_res.scalars().all():
                per.section = new_name

            # Update assigned_sections in users
            u_res = await db.execute(select(User))
            for u in u_res.scalars().all():
                if u.assigned_sections and old_name in u.assigned_sections:
                    u.assigned_sections = [new_name if s == old_name else s for s in u.assigned_sections]

    if data.description is not None:
        sec.description = data.description.strip()

    await db.commit()
    await db.refresh(sec)
    logger.info("Updated section id=%d ('%s' -> '%s')", section_id, old_name, sec.name)
    return await _enrich_section(sec, db)


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(
    section_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("sections:manage", "users:manage")),
):
    """Delete a section. Cameras and persons previously in this section become unassigned."""
    sec = await db.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="بخش یافت نشد.")

    name = sec.name
    # Unassign cameras
    cam_res = await db.execute(select(Camera).where(Camera.section == name))
    for cam in cam_res.scalars().all():
        cam.section = ""

    # Unassign persons
    per_res = await db.execute(select(Person).where(Person.section == name))
    for per in per_res.scalars().all():
        per.section = ""

    # Remove from users
    u_res = await db.execute(select(User))
    for u in u_res.scalars().all():
        if u.assigned_sections and name in u.assigned_sections:
            u.assigned_sections = [s for s in u.assigned_sections if s != name]

    await db.delete(sec)
    await db.commit()
    logger.info("Deleted section '%s' (id=%d)", name, section_id)
