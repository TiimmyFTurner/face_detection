"""
Roles and Permissions Router — Dynamic Role Management and Permissions Registry.
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import (
    ALL_PERMISSIONS,
    SECTIONS_METADATA,
    require_any_permission,
    require_permission,
)
from backend.database import get_db
from backend.models import Role, User
from backend.schemas import RoleCreate, RoleResponse, RoleUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/roles", tags=["roles"])


def _slugify(text: str) -> str:
    """Generate safe identifier slug from English/Persian text."""
    slug = re.sub(r"[^\w\s-]", "", text.strip().lower())
    return re.sub(r"[-\s]+", "_", slug)[:50] or "custom_role"


@router.get("/permissions-registry")
async def get_permissions_registry(
    _user=Depends(require_any_permission("users:view", "users:manage")),
):
    """Return categorized matrix of all 18 granular permissions for UI form builders."""
    return {
        "sections": SECTIONS_METADATA,
        "all_permissions": ALL_PERMISSIONS,
    }


@router.get("", response_model=list[RoleResponse])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("users:view", "users:manage")),
):
    """List all configured roles with assigned user counts and permissions."""
    # Count users per role
    stmt_counts = select(User.role_id, func.count(User.id)).group_by(User.role_id)
    res_counts = await db.execute(stmt_counts)
    user_counts_map = dict(res_counts.all())

    stmt = select(Role).order_by(Role.id.asc())
    result = await db.execute(stmt)
    roles = result.scalars().all()

    response = []
    for r in roles:
        resp_item = RoleResponse(
            id=r.id,
            name=r.name,
            display_name=r.display_name,
            description=r.description or "",
            permissions=r.permissions or [],
            is_system=r.is_system,
            user_count=user_counts_map.get(r.id, 0),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        response.append(resp_item)

    return response


@router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
    data: RoleCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    """Create a new custom role with a specific set of granular permissions."""
    slug = _slugify(data.name)

    # Check for existing role name
    stmt = select(Role).where((Role.name == slug) | (Role.display_name == data.display_name.strip()))
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="نقشی با این نام یا شناسه از قبل وجود دارد.",
        )

    # Validate permissions list
    valid_perms = set(ALL_PERMISSIONS) | {"*"}
    filtered_perms = [p for p in data.permissions if p in valid_perms]

    role = Role(
        name=slug,
        display_name=data.display_name.strip(),
        description=data.description or "",
        permissions=filtered_perms,
        is_system=False,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)

    logger.info("Created custom role '%s' (%s) with %d permissions", role.name, role.display_name, len(filtered_perms))
    return RoleResponse(
        id=role.id,
        name=role.name,
        display_name=role.display_name,
        description=role.description,
        permissions=role.permissions,
        is_system=role.is_system,
        user_count=0,
        created_at=role.created_at,
        updated_at=role.updated_at,
    )


@router.get("/{role_id}", response_model=RoleResponse)
async def get_role(
    role_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("users:view", "users:manage")),
):
    """Get details of a specific role."""
    stmt = select(Role).where(Role.id == role_id)
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="نقش مورد نظر یافت نشد.")

    # Count assigned users
    count_res = await db.execute(select(func.count(User.id)).where(User.role_id == role_id))
    user_count = count_res.scalar() or 0

    return RoleResponse(
        id=role.id,
        name=role.name,
        display_name=role.display_name,
        description=role.description,
        permissions=role.permissions or [],
        is_system=role.is_system,
        user_count=user_count,
        created_at=role.created_at,
        updated_at=role.updated_at,
    )


@router.put("/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: int,
    data: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    """Update role display name, description, and permissions."""
    stmt = select(Role).where(Role.id == role_id)
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="نقش مورد نظر یافت نشد.")

    if data.display_name is not None:
        role.display_name = data.display_name.strip()
    if data.description is not None:
        role.description = data.description.strip()

    if data.permissions is not None:
        # If admin role, preserve full access
        if role.name == "admin":
            role.permissions = ["*"]
        else:
            valid_perms = set(ALL_PERMISSIONS) | {"*"}
            role.permissions = [p for p in data.permissions if p in valid_perms]

    await db.commit()
    await db.refresh(role)

    count_res = await db.execute(select(func.count(User.id)).where(User.role_id == role_id))
    user_count = count_res.scalar() or 0

    logger.info("Updated role '%s' permissions: %s", role.name, role.permissions)
    return RoleResponse(
        id=role.id,
        name=role.name,
        display_name=role.display_name,
        description=role.description,
        permissions=role.permissions or [],
        is_system=role.is_system,
        user_count=user_count,
        created_at=role.created_at,
        updated_at=role.updated_at,
    )


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    """Delete a custom role (system roles and roles with assigned users cannot be deleted)."""
    stmt = select(Role).where(Role.id == role_id)
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="نقش مورد نظر یافت نشد.")

    if role.is_system or role.name in ("admin", "supervisor", "operator", "viewer"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="نقش‌های پیش‌فرض و سیستمی قابل حذف نیستند.",
        )

    # Check if assigned to any user
    count_res = await db.execute(select(func.count(User.id)).where(User.role_id == role_id))
    user_count = count_res.scalar() or 0
    if user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"این نقش به {user_count} کاربر اختصاص داده شده است و نمی‌توان آن را حذف کرد. ابتدا نقش کاربران را تغییر دهید.",
        )

    await db.delete(role)
    await db.commit()
    logger.info("Deleted custom role '%s' (id=%d)", role.name, role_id)
