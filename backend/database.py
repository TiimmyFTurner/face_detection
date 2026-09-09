"""
Async SQLAlchemy database setup.
Provides engine, session factory, and FastAPI dependency injection.
"""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings


# ── Engine & Session ─────────────────────────────────────
engine = create_async_engine(
    settings.database_url,
    echo=False,
    # SQLite-specific: allow concurrent reads
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ── Base Model ───────────────────────────────────────────
class Base(DeclarativeBase):
    """Declarative base for all ORM models."""
    pass


# ── Initialization ───────────────────────────────────────
async def init_db() -> None:
    """Create all database tables on startup and run backward-compatible column migrations."""
    async with engine.begin() as conn:
        # Import models so they register with Base.metadata
        import backend.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

        # Run auto-migration for newly added columns if table already existed
        def _migrate(sync_conn):
            try:
                res = sync_conn.exec_driver_sql("PRAGMA table_info(events)")
                cols = {row[1] for row in res.fetchall()}
                if cols:
                    if "zone_id" not in cols:
                        sync_conn.exec_driver_sql("ALTER TABLE events ADD COLUMN zone_id INTEGER")
                    if "zone_name" not in cols:
                        sync_conn.exec_driver_sql("ALTER TABLE events ADD COLUMN zone_name VARCHAR(255) DEFAULT ''")
                    if "alert_type" not in cols:
                        sync_conn.exec_driver_sql("ALTER TABLE events ADD COLUMN alert_type VARCHAR(50) DEFAULT 'normal'")
                    if "duration_seconds" not in cols:
                        sync_conn.exec_driver_sql("ALTER TABLE events ADD COLUMN duration_seconds INTEGER")

                z_res = sync_conn.exec_driver_sql("PRAGMA table_info(camera_zones)")
                z_cols = {row[1] for row in z_res.fetchall()}
                if z_cols:
                    if "start_time" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN start_time VARCHAR(10) DEFAULT '00:00'")
                    if "end_time" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN end_time VARCHAR(10) DEFAULT '23:59'")
                    if "active_days" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN active_days JSON")

                # Data backfill for existing records
                sync_conn.exec_driver_sql("UPDATE camera_zones SET start_time = '00:00' WHERE start_time IS NULL OR start_time = ''")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET end_time = '23:59' WHERE end_time IS NULL OR end_time = ''")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET active_days = '[\"Mon\", \"Tue\", \"Wed\", \"Thu\", \"Fri\", \"Sat\", \"Sun\"]' WHERE active_days IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET assigned_person_ids = '[]' WHERE assigned_person_ids IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET alert_mode = 'absence' WHERE alert_mode IS NULL OR alert_mode = ''")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET is_active = 1 WHERE is_active IS NULL")
                sync_conn.exec_driver_sql("UPDATE events SET alert_type = 'normal' WHERE alert_type IS NULL OR alert_type = ''")
                sync_conn.exec_driver_sql("UPDATE events SET zone_name = '' WHERE zone_name IS NULL")
                sync_conn.exec_driver_sql("UPDATE cameras SET rtsp_url = replace(rtsp_url, '%40', '@') WHERE instr(rtsp_url, '%40') > 0")
            except Exception:
                pass

        await conn.run_sync(_migrate)

    # Auto-seed default roles and super admin if not present
    await _seed_defaults()


async def _seed_defaults() -> None:
    """Seed initial roles and superadmin user if database is empty."""
    from sqlalchemy import select
    from backend.models import Role, User
    from backend.auth import hash_password

    async with async_session() as session:
        # Check / Seed Roles
        res = await session.execute(select(Role))
        existing_roles = {r.name: r for r in res.scalars().all()}

        default_roles_data = [
            {
                "name": "admin",
                "display_name": "مدیر سیستم",
                "description": "دسترسی کامل به تمامی بخش‌ها، تنظیمات، دوربین‌ها و مدیریت کاربران",
                "permissions": ["*"],
                "is_system": True,
            },
            {
                "name": "supervisor",
                "display_name": "سرپرست کارخانه / ناظر",
                "description": "دسترسی به پیشخوان، شیفت‌ها، منطقه‌ها، دوربین‌ها و پرسنل بدون دسترسی به کاربران",
                "permissions": [
                    "dashboard:view", "events:export", "duty:view", "duty:manage",
                    "zones:view", "zones:create", "zones:edit", "zones:delete",
                    "cameras:view", "cameras:create", "cameras:edit", "cameras:test",
                    "persons:view", "persons:create", "persons:edit", "settings:view",
                ],
                "is_system": False,
            },
            {
                "name": "operator",
                "display_name": "اپراتور حراست / مانیتورینگ",
                "description": "مشاهده رویدادهای زنده، دوربین‌ها، پرسنل حاضر در شیفت و تایید هشدارهای غیبت",
                "permissions": [
                    "dashboard:view", "duty:view", "duty:manage",
                    "cameras:view", "persons:view",
                ],
                "is_system": False,
            },
            {
                "name": "viewer",
                "display_name": "مشاهده‌گر / بازرس",
                "description": "فقط مشاهده آمار پیشخوان و وضعیت شیفت پرسنل",
                "permissions": [
                    "dashboard:view", "duty:view",
                ],
                "is_system": False,
            },
        ]

        for rdata in default_roles_data:
            if rdata["name"] not in existing_roles:
                role = Role(
                    name=rdata["name"],
                    display_name=rdata["display_name"],
                    description=rdata["description"],
                    permissions=rdata["permissions"],
                    is_system=rdata["is_system"],
                )
                session.add(role)

        await session.commit()

        # Re-fetch admin role
        admin_role_res = await session.execute(select(Role).where(Role.name == "admin"))
        admin_role = admin_role_res.scalar_one_or_none()

        # Check / Seed default Admin User
        user_res = await session.execute(select(User).where(User.username == "admin"))
        admin_user = user_res.scalar_one_or_none()
        if not admin_user:
            pwd_hash, salt = hash_password("admin123")
            admin_user = User(
                username="admin",
                full_name="مدیر ارشد سامانه",
                password_hash=pwd_hash,
                salt=salt,
                role_id=admin_role.id if admin_role else None,
                custom_permissions=[],
                is_active=True,
            )
            session.add(admin_user)
            await session.commit()

async def get_db() -> AsyncSession:
    """Yield an async database session for request-scoped use."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
