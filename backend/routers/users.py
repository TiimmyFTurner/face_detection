"""
Users Router — User Account Management (CRUD, Role Assignment, Password Reset).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import (
    get_current_user,
    get_user_permissions,
    hash_password,
    require_any_permission,
    require_permission,
)
from backend.database import get_db
from backend.models import Role, User
from backend.schemas import (
    PasswordResetRequest,
    UserCreate,
    UserResponse,
    UserUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["users"])


def _to_user_response(user: User) -> UserResponse:
    """Helper to convert User model to UserResponse schema."""
    role_name = user.role.name if user.role else ""
    role_display = user.role.display_name if user.role else ""
    effective_perms = list(get_user_permissions(user))
    return UserResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role_id=user.role_id,
        role_name=role_name,
        role_display_name=role_display,
        custom_permissions=user.custom_permissions or [],
        effective_permissions=effective_perms,
        permissions=effective_perms,
        is_active=user.is_active,
        last_login=user.last_login,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get("", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("users:view", "users:manage")),
):
    """List all registered users with their assigned roles and status."""
    stmt = select(User).options(selectinload(User.role)).order_by(User.id.asc())
    result = await db.execute(stmt)
    users = result.scalars().all()
    return [_to_user_response(u) for u in users]


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    """Create a new user account and assign a role."""
    username = data.username.strip().lower()

    # Check if username exists
    stmt = select(User).where(User.username == username)
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"نام کاربری '{username}' از قبل وجود دارد.",
        )

    # Validate role if provided
    role_id = data.role_id
    if role_id:
        role_res = await db.execute(select(Role).where(Role.id == role_id))
        if not role_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="نقش انتخاب‌شده نامعتبر است.")

    pwd_hash, salt = hash_password(data.password)
    user = User(
        username=username,
        full_name=data.full_name.strip(),
        password_hash=pwd_hash,
        salt=salt,
        role_id=role_id,
        custom_permissions=data.custom_permissions or [],
        is_active=data.is_active,
    )
    db.add(user)
    await db.commit()

    # Re-fetch with loaded role
    stmt_reload = select(User).options(selectinload(User.role)).where(User.id == user.id)
    reloaded_res = await db.execute(stmt_reload)
    reloaded_user = reloaded_res.scalar_one()

    logger.info("Created user '%s' (role_id=%s)", user.username, user.role_id)
    return _to_user_response(reloaded_user)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_permission("users:view", "users:manage")),
):
    """Get details of a specific user."""
    stmt = select(User).options(selectinload(User.role)).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="کاربر یافت نشد.")
    return _to_user_response(user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    """Update user full name, role, custom permissions, status, or password."""
    stmt = select(User).options(selectinload(User.role)).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="کاربر یافت نشد.")

    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.role_id is not None:
        role_res = await db.execute(select(Role).where(Role.id == data.role_id))
        if not role_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="نقش انتخاب‌شده نامعتبر است.")
        user.role_id = data.role_id
    if data.custom_permissions is not None:
        user.custom_permissions = data.custom_permissions
    if data.is_active is not None:
        # Prevent deactivating the last active admin
        if not data.is_active and user.role and user.role.name == "admin":
            admin_count = await db.scalar(
                select(func.count(User.id))
                .join(Role)
                .where(Role.name == "admin", User.is_active == True, User.id != user_id)
            )
            if (admin_count or 0) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="نمی‌توانید آخرین مدیر فعال سیستم را غیرفعال کنید.",
                )
        user.is_active = data.is_active

    if data.password:
        pwd_hash, salt = hash_password(data.password)
        user.password_hash = pwd_hash
        user.salt = salt

    await db.commit()
    await db.refresh(user)

    stmt_reload = select(User).options(selectinload(User.role)).where(User.id == user.id)
    reloaded_res = await db.execute(stmt_reload)
    reloaded_user = reloaded_res.scalar_one()

    logger.info("Updated user '%s'", user.username)
    return _to_user_response(reloaded_user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users:manage")),
):
    """Delete a user account."""
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="شما نمی‌توانید حساب کاربری جاری خود را حذف کنید.",
        )

    stmt = select(User).options(selectinload(User.role)).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="کاربر یافت نشد.")

    # Check if deleting last admin
    if user.role and user.role.name == "admin":
        admin_count = await db.scalar(
            select(func.count(User.id))
            .join(Role)
            .where(Role.name == "admin", User.id != user_id)
        )
        if (admin_count or 0) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="نمی‌توانید آخرین حساب مدیر کل سیستم را حذف کنید.",
            )

    await db.delete(user)
    await db.commit()
    logger.info("Deleted user '%s' (id=%d)", user.username, user_id)


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    data: PasswordResetRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("users:manage")),
):
    """Reset a user's password as an administrator."""
    stmt = select(User).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="کاربر یافت نشد.")

    pwd_hash, salt = hash_password(data.new_password)
    user.password_hash = pwd_hash
    user.salt = salt
    await db.commit()

    logger.info("Admin reset password for user '%s'", user.username)
    return {"success": True, "message": f"کلمه عبور کاربر '{user.username}' با موفقیت بازنشانی شد."}
