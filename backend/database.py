"""
Async SQLAlchemy database setup.
Provides engine, session factory, and FastAPI dependency injection.
"""

from sqlalchemy import event
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

if "sqlite" in settings.database_url:
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

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
                    if "absence_timeout_minutes" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN absence_timeout_minutes INTEGER DEFAULT 2")
                    if "grace_period_minutes" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN grace_period_minutes INTEGER DEFAULT 10")
                    if "free_times" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN free_times JSON")
                    if "shift_name" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN shift_name VARCHAR(255) DEFAULT ''")
                    if "shifts" not in z_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE camera_zones ADD COLUMN shifts JSON")

                # Cameras table migration
                cam_res = sync_conn.exec_driver_sql("PRAGMA table_info(cameras)")
                cam_cols = {row[1] for row in cam_res.fetchall()}
                if cam_cols and "section" not in cam_cols:
                    sync_conn.exec_driver_sql("ALTER TABLE cameras ADD COLUMN section VARCHAR(255) DEFAULT ''")

                # Persons table migration
                p_res = sync_conn.exec_driver_sql("PRAGMA table_info(persons)")
                p_cols = {row[1] for row in p_res.fetchall()}
                if p_cols:
                    if "section" not in p_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE persons ADD COLUMN section VARCHAR(255) DEFAULT ''")
                    if "shift_template_id" not in p_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE persons ADD COLUMN shift_template_id INTEGER")
                    if "custom_shift" not in p_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE persons ADD COLUMN custom_shift JSON")
                    if "leaves" not in p_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE persons ADD COLUMN leaves JSON")

                # Shift templates table migration
                st_res = sync_conn.exec_driver_sql("PRAGMA table_info(shift_templates)")
                st_cols = {row[1] for row in st_res.fetchall()}
                if st_cols:
                    if "shift_type" not in st_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE shift_templates ADD COLUMN shift_type VARCHAR(50) DEFAULT 'fixed'")
                    if "rotation_pattern" not in st_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE shift_templates ADD COLUMN rotation_pattern JSON")

                # Users table migration
                u_res = sync_conn.exec_driver_sql("PRAGMA table_info(users)")
                u_cols = {row[1] for row in u_res.fetchall()}
                if u_cols:
                    if "assigned_sections" not in u_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE users ADD COLUMN assigned_sections JSON")
                    if "assigned_camera_ids" not in u_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE users ADD COLUMN assigned_camera_ids JSON")
                    if "assigned_person_ids" not in u_cols:
                        sync_conn.exec_driver_sql("ALTER TABLE users ADD COLUMN assigned_person_ids JSON")

                # Data backfill for existing records
                sync_conn.exec_driver_sql("UPDATE shift_templates SET shift_type = 'fixed' WHERE shift_type IS NULL OR shift_type = ''")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET start_time = '00:00' WHERE start_time IS NULL OR start_time = ''")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET end_time = '23:59' WHERE end_time IS NULL OR end_time = ''")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET active_days = '[\"Mon\", \"Tue\", \"Wed\", \"Thu\", \"Fri\", \"Sat\", \"Sun\"]' WHERE active_days IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET assigned_person_ids = '[]' WHERE assigned_person_ids IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET alert_mode = 'absence' WHERE alert_mode IS NULL OR alert_mode = ''")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET absence_timeout_minutes = 2 WHERE absence_timeout_minutes IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET grace_period_minutes = 10 WHERE grace_period_minutes IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET free_times = '[]' WHERE free_times IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET shift_name = '' WHERE shift_name IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET shifts = '[]' WHERE shifts IS NULL")
                sync_conn.exec_driver_sql("UPDATE camera_zones SET is_active = 1 WHERE is_active IS NULL")
                sync_conn.exec_driver_sql("UPDATE events SET alert_type = 'normal' WHERE alert_type IS NULL OR alert_type = ''")
                sync_conn.exec_driver_sql("UPDATE events SET zone_name = '' WHERE zone_name IS NULL")
                sync_conn.exec_driver_sql("UPDATE events SET confidence_score = 0.0 WHERE alert_type IN ('camera_disconnected', 'absence_timeout') AND confidence_score > 0")
                sync_conn.exec_driver_sql("UPDATE cameras SET rtsp_url = replace(rtsp_url, '%40', '@') WHERE instr(rtsp_url, '%40') > 0")
                sync_conn.exec_driver_sql("UPDATE cameras SET section = '' WHERE section IS NULL")
                sync_conn.exec_driver_sql("UPDATE persons SET section = '' WHERE section IS NULL")
                sync_conn.exec_driver_sql("UPDATE users SET assigned_sections = '[]' WHERE assigned_sections IS NULL")
                sync_conn.exec_driver_sql("UPDATE users SET assigned_camera_ids = '[]' WHERE assigned_camera_ids IS NULL")
                sync_conn.exec_driver_sql("UPDATE users SET assigned_person_ids = '[]' WHERE assigned_person_ids IS NULL")

                # Clean up orphan camera zones whose camera was previously deleted
                sync_conn.exec_driver_sql("DELETE FROM camera_zones WHERE camera_id NOT IN (SELECT id FROM cameras)")
                # Clean up orphan disconnect / absence alerts for cameras that no longer exist
                sync_conn.exec_driver_sql(
                    "DELETE FROM events WHERE alert_type IN ('camera_disconnected', 'absence_timeout') "
                    "AND (camera_id IS NULL OR camera_id NOT IN (SELECT id FROM cameras))"
                )
                # Unlink camera_id on remaining historical events if camera was deleted
                sync_conn.exec_driver_sql(
                    "UPDATE events SET camera_id = NULL WHERE camera_id IS NOT NULL "
                    "AND camera_id NOT IN (SELECT id FROM cameras)"
                )
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
                "description": "دسترسی به پیشخوان سرپرست، شیفت‌ها و مرخصی‌های پرسنل منتسب (بدون دسترسی به تصویر یا دوربین)",
                "permissions": [
                    "dashboard:view", "duty:view", "duty:manage",
                    "zones:view", "persons:view", "persons:edit",
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

        # Update existing supervisor role to ensure safe permissions (no cameras:view/cameras:test/events:export)
        sup_role_res = await session.execute(select(Role).where(Role.name == "supervisor"))
        sup_role = sup_role_res.scalar_one_or_none()
        if sup_role:
            sup_role.permissions = [
                "dashboard:view", "duty:view", "duty:manage",
                "zones:view", "persons:view", "persons:edit",
            ]
            sup_role.description = "دسترسی به پیشخوان سرپرست، شیفت‌ها و مرخصی‌های پرسنل منتسب (بدون دسترسی به تصویر یا دوربین)"

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

        # Check / Seed default Shift Templates
        from backend.models import ShiftTemplate
        shift_res = await session.execute(select(ShiftTemplate))
        existing_shifts = shift_res.scalars().all()
        if not existing_shifts:
            default_shifts_data = [
                {
                    "name": "شیفت صبح (Morning)",
                    "start_time": "07:00",
                    "end_time": "15:00",
                    "color": "#38bdf8",
                    "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"],
                    "grace_period_minutes": 10,
                    "absence_timeout_minutes": 2,
                    "free_times": [{"name": "ناهار (Lunch)", "start_time": "12:00", "end_time": "13:00"}],
                },
                {
                    "name": "شیفت عصر (Evening)",
                    "start_time": "15:00",
                    "end_time": "23:00",
                    "color": "#f59e0b",
                    "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"],
                    "grace_period_minutes": 10,
                    "absence_timeout_minutes": 2,
                    "free_times": [{"name": "عصرانه (Tea Break)", "start_time": "18:00", "end_time": "18:30"}],
                },
                {
                    "name": "شیفت شب (Night / Overnight)",
                    "start_time": "23:00",
                    "end_time": "07:00",
                    "color": "#a855f7",
                    "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
                    "grace_period_minutes": 10,
                    "absence_timeout_minutes": 2,
                    "free_times": [{"name": "استراحت نیمه‌شب (Midnight Rest)", "start_time": "03:00", "end_time": "03:45"}],
                },
                {
                    "name": "شیفت اداری (Office Hours)",
                    "start_time": "08:00",
                    "end_time": "17:00",
                    "color": "#10b981",
                    "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed"],
                    "grace_period_minutes": 15,
                    "absence_timeout_minutes": 5,
                    "free_times": [{"name": "ناهار و استراحت (Lunch)", "start_time": "12:30", "end_time": "13:30"}],
                },
            ]
            for sdata in default_shifts_data:
                st = ShiftTemplate(
                    name=sdata["name"],
                    start_time=sdata["start_time"],
                    end_time=sdata["end_time"],
                    color=sdata["color"],
                    active_days=sdata["active_days"],
                    grace_period_minutes=sdata["grace_period_minutes"],
                    absence_timeout_minutes=sdata["absence_timeout_minutes"],
                    free_times=sdata["free_times"],
                )
                session.add(st)
            await session.commit()

        # Seed Rotational Shift Templates if not existing
        shift_res_after = await session.execute(select(ShiftTemplate))
        curr_shifts = shift_res_after.scalars().all()
        curr_names = {s.name for s in curr_shifts}

        rotational_presets = [
            {
                "name": "نوبت‌کاری چرخشی (۲ روز، ۲ شب، ۱ آف)",
                "start_time": "07:00",
                "end_time": "19:00",
                "color": "#ec4899",
                "shift_type": "rotational",
                "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
                "grace_period_minutes": 15,
                "absence_timeout_minutes": 5,
                "free_times": [],
                "rotation_pattern": {
                    "pattern_type": "2d_2n_1off",
                    "cycle": ["day", "day", "night", "night", "off"],
                    "anchor_date": "2026-01-01",
                    "day_start": "07:00",
                    "day_end": "19:00",
                    "night_start": "19:00",
                    "night_end": "07:00",
                },
            },
            {
                "name": "نوبت‌کاری چرخشی (۲ روز، ۲ شب، ۲ آف)",
                "start_time": "07:00",
                "end_time": "19:00",
                "color": "#8b5cf6",
                "shift_type": "rotational",
                "active_days": ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
                "grace_period_minutes": 15,
                "absence_timeout_minutes": 5,
                "free_times": [],
                "rotation_pattern": {
                    "pattern_type": "2d_2n_2off",
                    "cycle": ["day", "day", "night", "night", "off", "off"],
                    "anchor_date": "2026-01-01",
                    "day_start": "07:00",
                    "day_end": "19:00",
                    "night_start": "19:00",
                    "night_end": "07:00",
                },
            },
        ]
        added_rot = False
        for rdata in rotational_presets:
            if rdata["name"] not in curr_names:
                st = ShiftTemplate(
                    name=rdata["name"],
                    start_time=rdata["start_time"],
                    end_time=rdata["end_time"],
                    color=rdata["color"],
                    shift_type=rdata["shift_type"],
                    active_days=rdata["active_days"],
                    grace_period_minutes=rdata["grace_period_minutes"],
                    absence_timeout_minutes=rdata["absence_timeout_minutes"],
                    free_times=rdata["free_times"],
                    rotation_pattern=rdata["rotation_pattern"],
                )
                session.add(st)
                added_rot = True
        if added_rot:
            await session.commit()

        # Check / Seed default Sections
        from backend.models import Section
        sec_res = await session.execute(select(Section))
        if not sec_res.scalars().all():
            default_sections = [
                {"name": "بسته‌بندی (Packaging)", "description": "خطوط بسته‌بندی، توزین و الصاق برچسب"},
                {"name": "خط تولید (Production)", "description": "سالن اصلی مونتاژ و ماشین‌آلات ساخت"},
                {"name": "انبار و لجستیک (Warehouse)", "description": "انبار مواد اولیه، بارگیری و محصولات نهایی"},
                {"name": "کنترل کیفیت (QC)", "description": "ایستگاه‌های آزمایشگاهی و بازرسی کیفی"},
                {"name": "اداری و مالی (Office)", "description": "دفاتر سرپرستی، حراست و مدیریت"},
            ]
            for s in default_sections:
                session.add(Section(name=s["name"], description=s["description"]))
            await session.commit()

        # Check / Seed default Break Presets
        from backend.models import BreakPreset
        bp_res = await session.execute(select(BreakPreset))
        if not bp_res.scalars().all():
            default_presets = [
                {"name": "ناهار (Lunch)", "start_time": "12:00", "end_time": "13:00", "category": "lunch", "icon": "🍽️"},
                {"name": "ناهار و نماز (Lunch & Prayer)", "start_time": "12:30", "end_time": "13:30", "category": "lunch", "icon": "🍱"},
                {"name": "عصرانه و چای (Tea Break)", "start_time": "16:00", "end_time": "16:30", "category": "rest", "icon": "☕"},
                {"name": "استراحت شبانه (Midnight Rest)", "start_time": "03:00", "end_time": "03:45", "category": "rest", "icon": "🌙"},
            ]
            for p in default_presets:
                session.add(BreakPreset(
                    name=p["name"],
                    start_time=p["start_time"],
                    end_time=p["end_time"],
                    category=p["category"],
                    icon=p["icon"],
                ))
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
