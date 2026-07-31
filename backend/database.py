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
    """Create all database tables on startup."""
    async with engine.begin() as conn:
        # Import models so they register with Base.metadata
        import backend.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)


# ── FastAPI Dependency ───────────────────────────────────
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
