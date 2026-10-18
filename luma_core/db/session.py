from collections.abc import AsyncGenerator

from sqlalchemy import StaticPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from luma_core.config import get_settings

settings = get_settings()


def _normalize_database_url(url: str) -> str:
    """Ensure sqlite URLs use an async driver (aiosqlite).

    Keeps pysqlite URLs working for sync code while FastAPI/SQLAlchemy async
    endpoints use an async driver under the hood.
    """
    if url.startswith("sqlite:") and "+aiosqlite" not in url:
        url = url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return url


_ENGINE_URL = _normalize_database_url(settings.database_url)

engine = create_async_engine(
    _ENGINE_URL,
    echo=settings.database_url_echo,
    poolclass=StaticPool if _ENGINE_URL.startswith("sqlite") else None,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
