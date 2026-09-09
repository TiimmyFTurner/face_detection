"""
Authentication Router — Login, Logout, Session Info, and Password Change.
"""

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth import (
    TOKEN_EXPIRE_SECONDS,
    create_access_token,
    get_current_user,
    get_user_permissions,
    hash_password,
    verify_password,
)
from backend.database import get_db
from backend.models import User
from backend.schemas import (
    LoginRequest,
    PasswordChangeRequest,
    TokenResponse,
    UserResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_user_response(user: User) -> UserResponse:
    """Helper to convert User model with Role to UserResponse schema."""
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


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    """Authenticate user with username and password, returning signed Bearer token."""
    username = data.username.strip()
    stmt = select(User).options(selectinload(User.role)).where(User.username == username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash, user.salt):
        logger.warning("Failed login attempt for username: %s", username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="نام کاربری یا کلمه عبور نادرست است.",
        )

    if not user.is_active:
        logger.warning("Inactive user attempted login: %s", username)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="حساب کاربری شما غیرفعال شده است. لطفاً با مدیر سیستم تماس بگیرید.",
        )

    # Update last login timestamp
    user.last_login = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.username)
    logger.info("User '%s' logged in successfully.", user.username)

    # Set cookie for browser resources like <img> tags and MJPEG streams
    response.set_cookie(
        key="access_token",
        value=token,
        max_age=TOKEN_EXPIRE_SECONDS,
        httponly=False,
        samesite="lax",
        path="/",
    )

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=_build_user_response(user),
    )


@router.post("/logout")
async def logout(response: Response, current_user: User = Depends(get_current_user)):
    """Client logout acknowledgment."""
    logger.info("User '%s' logged out.", current_user.username)
    response.delete_cookie(key="access_token", path="/")
    return {"success": True, "message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return profile and active permissions of the currently authenticated user."""
    return _build_user_response(current_user)


@router.post("/change-password")
async def change_password(
    data: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Allow currently authenticated user to change their password."""
    if not verify_password(data.current_password, current_user.password_hash, current_user.salt):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="کلمه عبور فعلی نادرست است.",
        )

    pwd_hash, salt = hash_password(data.new_password)
    current_user.password_hash = pwd_hash
    current_user.salt = salt
    await db.commit()

    logger.info("User '%s' updated their password.", current_user.username)
    return {"success": True, "message": "کلمه عبور با موفقیت تغییر یافت."}
