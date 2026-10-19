from typing import AsyncGenerator

import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool
from unittest.mock import patch

from luma_core.app import app
from luma_core.db.session import Base
from luma_core.config import Settings

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
TEST_OWNER_TOKEN = "test-owner-token-12345"


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client bound to a fresh in-memory database.

    The app's ``get_db`` dependency is overridden and settings are patched
    to provide a known owner token for the duration of the test.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL,
        poolclass=StaticPool,
        echo=False,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    from luma_core.db.session import async_session_factory as original
    from luma_core.db import session as session_module

    session_module.async_session_factory = session_factory

    async def override_get_db():
        async with session_factory() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise

    # Create test settings with known token
    test_settings = Settings(local_owner_token=TEST_OWNER_TOKEN)

    app.dependency_overrides.clear()
    app.dependency_overrides[
        __import__("luma_core.db.session", fromlist=["get_db"]).get_db
    ] = override_get_db

    # Patch get_settings in both config and auth modules
    with patch("luma_core.auth.get_settings", return_value=test_settings):
        with patch("luma_core.config.get_settings", return_value=test_settings):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                # Add the owner token header to all requests by default
                ac.headers.update({"X-Luma-Owner-Token": TEST_OWNER_TOKEN})
                yield ac

    app.dependency_overrides.clear()
    session_module.async_session_factory = original
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()
