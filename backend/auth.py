"""
Authentication and Role-Based Access Control (RBAC) module.

Provides:
  - PBKDF2-HMAC-SHA256 password hashing and verification
  - Cryptographically signed HMAC-SHA256 Bearer tokens
  - Granular permission registry across 7 functional sections
  - User permission resolution with dynamic role support
  - FastAPI dependency injection for endpoint protection
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.config import settings
from backend.database import get_db
from backend.models import Role, User

logger = logging.getLogger(__name__)

# Secret key for signing bearer tokens
AUTH_SECRET_KEY = getattr(settings, "auth_secret_key", "facewatch-surveillance-secret-key-2026-secure-factory-auth")
TOKEN_EXPIRE_SECONDS = 7 * 24 * 3600  # 7 days

# ── Granular Permissions Registry ─────────────────────────────────
# 18 granular permissions categorized into 7 factory surveillance sections
SECTIONS_METADATA = [
    {
        "id": "dashboard",
        "title_fa": "پیشخوان و آمار",
        "title_en": "Dashboard & Statistics",
        "permissions": [
            {
                "key": "dashboard:view",
                "label_fa": "مشاهده پیشخوان و رویدادهای زنده",
                "label_en": "View Dashboard & Live Events",
                "description_fa": "مشاهده آمار کل، نمودارها و فید رویدادهای زنده",
                "description_en": "Access to overview statistics, charts, and live event feed",
            },
            {
                "key": "events:export",
                "label_fa": "خروجی گرفتن از رویدادها",
                "label_en": "Export Event Logs",
                "description_fa": "دریافت فایل اکسل / CSV وقایع ثبت‌شده",
                "description_en": "Download historical event records in CSV/Excel format",
            },
            {
                "key": "events:delete",
                "label_fa": "حذف رویدادها",
                "label_en": "Delete Events",
                "description_fa": "امکان حذف لاگ‌های تردد و تصاویر ثبت‌شده",
                "description_en": "Ability to delete detection event logs and snapshots",
            },
        ],
    },
    {
        "id": "duty",
        "title_fa": "شیفت و حضور و غیاب",
        "title_en": "Duty Roster & Attendance",
        "permissions": [
            {
                "key": "duty:view",
                "label_fa": "مشاهده شیفت و وضعیت حضور",
                "label_en": "View Duty Roster & Status",
                "description_fa": "مشاهده جدول پرسنل حاضر و هشدارهای عدم حضور در ایستگاه",
                "description_en": "View on-duty staff, station presence, and absence alerts",
            },
            {
                "key": "duty:manage",
                "label_fa": "مدیریت هشدارهای شیفت",
                "label_en": "Manage Duty Alerts",
                "description_fa": "تایید هشدارها و ثبت تذکر غیبت غیرمجاز",
                "description_en": "Acknowledge absence alerts and manage shift attendance",
            },
        ],
    },
    {
        "id": "zones",
        "title_fa": "منطقه‌ها و ایستگاه‌ها",
        "title_en": "Zones & Station Areas",
        "permissions": [
            {
                "key": "zones:view",
                "label_fa": "مشاهده منطقه‌ها و برنامه‌ها",
                "label_en": "View Zones & Schedules",
                "description_fa": "مشاهده محدوده ایستگاه‌ها، ساعات شیفت و افراد منتسب",
                "description_en": "View configured station ROIs, timetables, and assigned persons",
            },
            {
                "key": "zones:create",
                "label_fa": "تعریف منطقه جدید",
                "label_en": "Create New Zone",
                "description_fa": "ترسیم کادر ایستگاه جدید روی تصویر دوربین و ذخیره آن",
                "description_en": "Draw and create new surveillance zones on camera views",
            },
            {
                "key": "zones:edit",
                "label_fa": "ویرایش منطقه و شیفت",
                "label_en": "Edit Zones & Timetables",
                "description_fa": "تغییر ساعات کاری، پرسنل منتسب و محدوده هندسی منطقه",
                "description_en": "Modify zone bounds, shift hours, active days, and assigned persons",
            },
            {
                "key": "zones:delete",
                "label_fa": "حذف منطقه",
                "label_en": "Delete Zone",
                "description_fa": "حذف ایستگاه‌های کاری تعریف‌شده",
                "description_en": "Remove configured station zones",
            },
        ],
    },
    {
        "id": "cameras",
        "title_fa": "دوربین‌های مداربسته",
        "title_en": "Surveillance Cameras",
        "permissions": [
            {
                "key": "cameras:view",
                "label_fa": "مشاهده دوربین‌ها و تصویر زنده",
                "label_en": "View Cameras & Live Feeds",
                "description_fa": "مشاهده لیست دوربین‌ها، وضعیت آنلاین/آفلاین و پیش‌نمایش زنده",
                "description_en": "View camera list, connectivity status, and live MJPEG video feeds",
            },
            {
                "key": "cameras:create",
                "label_fa": "افزودن دوربین (تکی و گروهی)",
                "label_en": "Add Cameras (Single & Batch)",
                "description_fa": "افزودن دوربین از طریق لینک مستقیم، سازنده RTSP یا بازه IP",
                "description_en": "Add single cameras, use RTSP builder, or batch import via IP range",
            },
            {
                "key": "cameras:edit",
                "label_fa": "ویرایش دوربین",
                "label_en": "Edit Camera Details",
                "description_fa": "تغییر نام، آدرس استریم، موقعیت مکانی و فعال/غیرفعال‌سازی",
                "description_en": "Update camera name, location, RTSP stream URL, and toggle state",
            },
            {
                "key": "cameras:delete",
                "label_fa": "حذف دوربین",
                "label_en": "Delete Camera",
                "description_fa": "حذف کامل دوربین از سامانه",
                "description_en": "Permanently remove a camera from the system",
            },
            {
                "key": "cameras:test",
                "label_fa": "تست اتصال RTSP",
                "label_en": "Test RTSP Connection",
                "description_fa": "بررسی دسترسی به استریم شبکه و دریافت فریم تستی",
                "description_en": "Test network stream accessibility and capture test frames",
            },
        ],
    },
    {
        "id": "persons",
        "title_fa": "هویت‌ها و چهره‌ها",
        "title_en": "Persons & Faces",
        "permissions": [
            {
                "key": "persons:view",
                "label_fa": "مشاهده پرسنل و سوابق تردد",
                "label_en": "View Persons & Attendance History",
                "description_fa": "مشاهده گالری افراد، تصاویر مرجع و آنالیز تایم‌لاین ترددها",
                "description_en": "Browse enrolled persons, reference photos, and match timeline analytics",
            },
            {
                "key": "persons:create",
                "label_fa": "ثبت چهره و فرد جدید",
                "label_en": "Enroll New Person",
                "description_fa": "آپلود تصاویر مرجع، استخراج فیچرهای چهره و ثبت نام فرد",
                "description_en": "Upload reference photos, compute 512-d embeddings, and enroll individual",
            },
            {
                "key": "persons:edit",
                "label_fa": "ویرایش مشخصات فرد",
                "label_en": "Edit Person Details",
                "description_fa": "تغییر نام، سمت شغلی، افزودن یا حذف عکس‌های مرجع",
                "description_en": "Update person name, job role, and add/remove reference photos",
            },
            {
                "key": "persons:delete",
                "label_fa": "حذف هویت و چهره",
                "label_en": "Delete Person",
                "description_fa": "حذف کامل فرد و بردارهای بیومتریک از دیتابیس",
                "description_en": "Delete person and associated biometric embeddings",
            },
        ],
    },
    {
        "id": "settings",
        "title_fa": "تنظیمات پردازش و سامانه",
        "title_en": "System & Engine Settings",
        "permissions": [
            {
                "key": "settings:view",
                "label_fa": "مشاهده تنظیمات سامانه",
                "label_en": "View System Settings",
                "description_fa": "مشاهده آستانه تطبیق چهره، چرخه پایش Duty Cycle و مدل هوش مصنوعی",
                "description_en": "View face match threshold, duty cycle settings, and model info",
            },
            {
                "key": "settings:edit",
                "label_fa": "تغییر تنظیمات موتور هوش مصنوعی",
                "label_en": "Modify System Settings",
                "description_fa": "تنظیم دقت تطبیق، کاهش مقیاس، نادیده گرفتن افراد ناشناس",
                "description_en": "Update match thresholds, downscale factor, frame skipping, and duty cycles",
            },
        ],
    },
    {
        "id": "users",
        "title_fa": "کاربران و سطوح دسترسی (RBAC)",
        "title_en": "Users & Access Control (RBAC)",
        "permissions": [
            {
                "key": "users:view",
                "label_fa": "مشاهده کاربران و نقش‌ها",
                "label_en": "View Users & Roles",
                "description_fa": "مشاهده لیست کاربران سامانه، نقش‌های تعریف‌شده و تاریخچه ورود",
                "description_en": "View user accounts, roles list, and login timestamps",
            },
            {
                "key": "users:manage",
                "label_fa": "مدیریت کاربران و نقش‌ها",
                "label_en": "Manage Users & Roles",
                "description_fa": "ایجاد کاربر جدید، ایجاد و ویرایش نقش‌ها، تغییر دسترسی‌ها و ریست پسورد",
                "description_en": "Create/edit roles, assign granular permissions, manage user accounts, and reset passwords",
            },
        ],
    },
]

ALL_PERMISSIONS = [p["key"] for s in SECTIONS_METADATA for p in s["permissions"]]


# ── Password Hashing (PBKDF2-HMAC-SHA256) ─────────────────────────
def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    """
    Hash password with PBKDF2-HMAC-SHA256 and a random 32-byte salt.
    Returns (password_hash_hex, salt_hex).
    """
    if not salt:
        salt = secrets.token_hex(32)
    salt_bytes = bytes.fromhex(salt)
    key = hashlib.pbkdf2_hmac(
        hash_name="sha256",
        password=password.encode("utf-8"),
        salt=salt_bytes,
        iterations=100_000,
        dklen=32,
    )
    return key.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    """Verify password against stored PBKDF2 hash using constant-time comparison."""
    try:
        derived, _ = hash_password(password, salt)
        return hmac.compare_digest(derived, password_hash)
    except Exception:
        return False


# ── Token Generation & Verification (HMAC-SHA256) ───────────────────
def create_access_token(user_id: int, username: str, expires_in: int = TOKEN_EXPIRE_SECONDS) -> str:
    """Create a tamper-proof cryptographically signed access token."""
    now = int(time.time())
    payload = {
        "sub": user_id,
        "username": username,
        "iat": now,
        "exp": now + expires_in,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8").rstrip("=")
    signature = hmac.new(
        key=AUTH_SECRET_KEY.encode("utf-8"),
        msg=payload_b64.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{signature}"


def decode_access_token(token: str) -> Optional[dict]:
    """Validate token signature and expiry; return payload if valid, None otherwise."""
    if not token or "." not in token:
        return None
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, signature = parts
        expected_sig = hmac.new(
            key=AUTH_SECRET_KEY.encode("utf-8"),
            msg=payload_b64.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None

        # Re-add base64 padding
        padding = 4 - (len(payload_b64) % 4)
        if padding != 4:
            payload_b64 += "=" * padding

        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8"))
        if payload.get("exp", 0) < int(time.time()):
            return None  # Token expired
        return payload
    except Exception:
        return None


# ── Permission Resolution ─────────────────────────────────────────
def get_user_permissions(user: User) -> set[str]:
    """
    Compute effective set of permissions for a user:
    - If user has Admin role or '*' permission, grant ALL permissions.
    - Otherwise, merge permissions from the user's Role and any User.custom_permissions.
    """
    perms: set[str] = set()

    if user.role:
        role_perms = user.role.permissions or []
        if user.role.name == "admin" or "*" in role_perms:
            return set(ALL_PERMISSIONS) | {"*"}
        perms.update(role_perms)

    if user.custom_permissions:
        if "*" in user.custom_permissions:
            return set(ALL_PERMISSIONS) | {"*"}
        perms.update(user.custom_permissions)

    return perms


# ── FastAPI Dependencies ──────────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    token_param: Optional[str] = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate bearer token from Header, Query param (?token=), or Cookie."""
    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif token_param:
        token = token_param
    elif "access_token" in request.cookies:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    stmt = select(User).options(selectinload(User.role)).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated.",
        )

    return user


def require_permission(permission: str) -> Callable:
    """FastAPI dependency factory enforcing that the authenticated user possesses a specific permission."""

    async def _dependency(current_user: User = Depends(get_current_user)) -> User:
        effective_perms = get_user_permissions(current_user)
        if permission not in effective_perms:
            logger.warning(
                "Access denied for user '%s': missing required permission '%s'",
                current_user.username,
                permission,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: permission '{permission}' is required for this action.",
            )
        return current_user

    return _dependency


def require_any_permission(*permissions: str) -> Callable:
    """Enforce that the authenticated user has at least one of the listed permissions."""

    async def _dependency(current_user: User = Depends(get_current_user)) -> User:
        effective_perms = get_user_permissions(current_user)
        if not any(p in effective_perms for p in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: you do not have permission to perform this action.",
            )
        return current_user

    return _dependency
