from sqlalchemy.exc import OperationalError
from sqlalchemy.schema import CreateIndex

from luma_core.db.session import Base, engine

# Importing the model package registers every table and index on Base.metadata,
# so create_tables() works no matter which module the caller imported first.
from luma_core.models import models as _models  # noqa: F401


async def create_tables() -> None:
    """Create the schema, including indexes a pre-existing database is missing.

    ``create_all()`` skips tables that already exist, so an index added to the
    model after a database was first created (e.g. the partial unique index that
    keeps one primary manager per department) would never reach that database.
    ``CREATE INDEX IF NOT EXISTS`` is idempotent, which makes this safe to run on
    every startup.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table in Base.metadata.sorted_tables:
            for index in table.indexes:
                try:
                    await conn.execute(CreateIndex(index, if_not_exists=True))
                except OperationalError as exc:
                    raise RuntimeError(
                        f"Cannot create index {index.name!r} on table "
                        f"{table.name!r}: {exc}. If the database file predates "
                        "the current models, delete it and restart so the schema "
                        "is rebuilt."
                    ) from exc


async def drop_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
