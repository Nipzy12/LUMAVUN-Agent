"""Transaction- and concurrency-level tests for primary-manager creation.

``tests/test_security.py`` covers the HTTP surface; the tests here drive
``AgentService`` directly against a temporary file-backed SQLite database so the
transaction behaviour of ``create_primary_manager`` is actually exercised:

* the partial unique index that enforces one primary manager per department,
* the savepoint that keeps a losing manager insert from discarding the caller's
  transaction,
* the ``IntegrityError`` handler that adopts the surviving manager,
* two separate ``AsyncSession`` instances racing on the same department.
"""

import asyncio
import os
import shutil
import sqlite3
import tempfile
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from luma_core.agents.job_type_registry import JobTypeRegistry
from luma_core.agents.service import AgentService
from luma_core.db.session import Base
from luma_core.models import (
    Agent,
    AgentStatus,
    AgentType,
    AutonomyLevel,
    Department,
    DepartmentStatus,
)
from luma_core.models.agent import PRIMARY_MANAGER_INDEX

NOW = "2024-01-01T00:00:00+00:00"
DEVELOPMENT = "Development"

SessionFactory = async_sessionmaker[AsyncSession]


@pytest_asyncio.fixture
async def sessions() -> AsyncGenerator[SessionFactory, None]:
    """A file-backed SQLite database shared by independent sessions.

    The HTTP fixture uses in-memory SQLite with ``StaticPool``, so every session
    is funnelled through a single connection and two sessions can never model
    two concurrent writers. A temporary file gives each session its own
    connection to the same database.
    """
    directory = tempfile.mkdtemp(prefix="luma-manager-test-")
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{os.path.join(directory, 'test.db')}",
        connect_args={"timeout": 30},
    )
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            yield async_sessionmaker(
                engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autoflush=False,
            )
        finally:
            await engine.dispose()
    finally:
        shutil.rmtree(directory, ignore_errors=True)


async def seed_department(sessions: SessionFactory, name: str = DEVELOPMENT) -> int:
    async with sessions() as session:
        department = Department(
            name=name,
            status=DepartmentStatus.active,
            created_at=NOW,
            updated_at=NOW,
        )
        session.add(department)
        await session.commit()
        return department.id


def manager_row(department_id: int, name: str) -> Agent:
    agent = Agent(
        name=name,
        role="Dev Manager",
        autonomy_level=AutonomyLevel.supervised,
        status=AgentStatus.active,
        agent_type=AgentType.manager,
        department_id=department_id,
        managed_department_id=department_id,
        created_at=NOW,
        updated_at=NOW,
    )
    agent.set_skills([])
    return agent


async def count(sessions: SessionFactory, model, *criteria) -> int:
    async with sessions() as session:
        statement = select(func.count()).select_from(model)
        for criterion in criteria:
            statement = statement.where(criterion)
        return (await session.execute(statement)).scalar_one()


async def commit_primary_manager(sessions: SessionFactory, department_id: int) -> None:
    """Commit a primary manager the way a concurrent request would."""
    async with sessions() as session:
        session.add(manager_row(department_id, "Concurrent Manager"))
        await session.commit()


class _Diagnostics:
    def __init__(self, constraint_name: str) -> None:
        self.constraint_name = constraint_name


class _DriverError(Exception):
    def __init__(self, constraint_name: str) -> None:
        super().__init__("driver error")
        self.diag = _Diagnostics(constraint_name)


def _sqlite_integrity_error(message: str) -> IntegrityError:
    return IntegrityError("INSERT INTO agents ...", {}, sqlite3.IntegrityError(message))


def test_duplicate_detection_matches_only_the_primary_manager_index() -> None:
    """Only the primary-manager index may ever be treated as a duplicate."""
    service = AgentService(JobTypeRegistry())

    assert service._is_duplicate_manager_error(
        _sqlite_integrity_error("UNIQUE constraint failed: agents.managed_department_id")
    ) is True
    assert service._is_duplicate_manager_error(
        _sqlite_integrity_error(f"UNIQUE constraint failed: index '{PRIMARY_MANAGER_INDEX}'")
    ) is True
    assert service._is_duplicate_manager_error(
        _sqlite_integrity_error(f"duplicate key value violates unique constraint \"{PRIMARY_MANAGER_INDEX}\"")
    ) is True

    # Driver diagnostics (psycopg/asyncpg) report the constraint name directly.
    assert service._is_duplicate_manager_error(
        IntegrityError("INSERT ...", {}, _DriverError(PRIMARY_MANAGER_INDEX))
    ) is True
    assert service._is_duplicate_manager_error(
        IntegrityError("INSERT ...", {}, _DriverError("departments_name_key"))
    ) is False

    # Everything that is not the primary-manager index must be re-raised.
    assert service._is_duplicate_manager_error(
        _sqlite_integrity_error("NOT NULL constraint failed: agents.created_at")
    ) is False
    assert service._is_duplicate_manager_error(
        _sqlite_integrity_error("UNIQUE constraint failed: departments.name")
    ) is False
    assert service._is_duplicate_manager_error(
        _sqlite_integrity_error("FOREIGN KEY constraint failed")
    ) is False
    assert service._is_duplicate_manager_error(IntegrityError("INSERT ...", {}, None)) is False


@pytest.mark.asyncio
async def test_duplicate_primary_manager_insert_is_rejected_by_the_index(
    sessions: SessionFactory,
) -> None:
    """The database itself enforces the rule, and the savepoint protects the
    caller's outer transaction when the insert fails."""
    department_id = await seed_department(sessions)
    # The index allows the first manager for a department and rejects the second.
    await commit_primary_manager(sessions, department_id)

    async with sessions() as session:
        # Unrelated pending work in the same transaction.
        session.add(
            Department(
                name="Unrelated Department",
                status=DepartmentStatus.active,
                created_at=NOW,
                updated_at=NOW,
            )
        )
        await session.flush()

        with pytest.raises(IntegrityError) as excinfo:
            async with session.begin_nested():
                session.add(manager_row(department_id, "Duplicate Manager"))
                await session.flush()

        message = str(excinfo.value.orig).lower()
        assert "unique constraint failed" in message
        assert "agents.managed_department_id" in message
        assert AgentService()._is_duplicate_manager_error(excinfo.value) is True

        # The savepoint rolled back; the outer transaction is still usable and
        # still holds the unrelated insert.
        assert set((await session.execute(select(Department.name))).scalars().all()) == {
            DEVELOPMENT,
            "Unrelated Department",
        }
        await session.commit()

    assert await count(sessions, Agent, Agent.agent_type == AgentType.manager) == 1
    assert await count(sessions, Department) == 2


@pytest.mark.asyncio
async def test_service_recovers_from_duplicate_manager_conflict(
    sessions: SessionFactory,
) -> None:
    """A stale pre-check (the race window) must not fail the worker request.

    The pre-check is made to report "no manager" even though a concurrent
    transaction has just committed one - exactly what happens when the check and
    the insert are separated by another transaction's commit. The subsequent
    insert has to hit the index and the handler has to adopt the survivor.
    """
    department_id = await seed_department(sessions)
    await commit_primary_manager(sessions, department_id)

    service = AgentService(JobTypeRegistry())
    real_lookup = service.primary_manager
    lookups: list[int] = []

    async def stale_lookup(session, department_id_):
        lookups.append(department_id_)
        if len(lookups) == 1:
            # Pre-check performed before the concurrent transaction committed.
            return None
        return await real_lookup(session, department_id_)

    service.primary_manager = stale_lookup

    async with sessions() as session:
        worker, manager = await service.create_worker_with_manager(
            session=session,
            name="Race Winner",
            job_type="web developer",
        )

        assert manager.name == "Concurrent Manager"
        assert manager.id != worker.id
        # One pre-check plus one survivor lookup: the IntegrityError handler ran.
        assert len(lookups) == 2
        await session.commit()

    assert await count(sessions, Agent, Agent.agent_type == AgentType.manager) == 1
    assert await count(sessions, Agent, Agent.agent_type == AgentType.worker) == 1


@pytest.mark.asyncio
async def test_unrelated_pending_changes_survive_conflict_recovery(
    sessions: SessionFactory,
) -> None:
    """Pending updates and inserts made before the conflict must still commit.

    A full ``Session.rollback()`` in the handler would silently discard both the
    flushed UPDATE and the flushed INSERT below, so this test is what proves the
    recovery stays inside the savepoint.
    """
    department_id = await seed_department(sessions)
    other_department_id = await seed_department(sessions, "Ops")
    await commit_primary_manager(sessions, department_id)

    service = AgentService(JobTypeRegistry())
    real_lookup = service.primary_manager
    conflicts: list[int] = []

    async def stale_lookup(session, department_id_):
        conflicts.append(department_id_)
        if len(conflicts) == 1:
            return None
        return await real_lookup(session, department_id_)

    service.primary_manager = stale_lookup

    async with sessions() as session:
        # An UPDATE and an INSERT that are already in the database but not yet
        # committed when the manager insert conflicts.
        ops = (
            await session.execute(select(Department).where(Department.id == other_department_id))
        ).scalar_one()
        ops.name = "Ops (Renamed)"
        session.add(
            Department(
                name="Unrelated Department",
                status=DepartmentStatus.active,
                created_at=NOW,
                updated_at=NOW,
            )
        )
        await session.flush()

        worker, manager = await service.create_worker_with_manager(
            session=session,
            name="Recovered Worker",
            job_type="web developer",
        )
        assert manager.name == "Concurrent Manager"
        assert len(conflicts) == 2
        await session.commit()

    async with sessions() as fresh:
        department_names = set((await fresh.execute(select(Department.name))).scalars().all())
        worker_names = (await fresh.execute(select(Agent.name))).scalars().all()

    assert {"Development", "Ops (Renamed)", "Unrelated Department"} <= department_names
    assert "Recovered Worker" in worker_names
    assert await count(sessions, Agent, Agent.agent_type == AgentType.manager) == 1
    assert await count(sessions, Agent, Agent.agent_type == AgentType.worker) == 1


@pytest.mark.asyncio
async def test_unrelated_integrity_error_is_reraised(sessions: SessionFactory) -> None:
    """A constraint failure that is not the primary-manager index must surface."""
    await seed_department(sessions)

    service = AgentService(JobTypeRegistry())
    # agents.created_at is NOT NULL: a None timestamp is an integrity error that
    # has nothing to do with the primary-manager index.
    service._now_iso = lambda: None

    async with sessions() as session:
        with pytest.raises(IntegrityError) as excinfo:
            await service.create_worker_with_manager(
                session=session,
                name="Broken Worker",
                job_type="web developer",
            )

        message = str(excinfo.value.orig).lower()
        assert "not null constraint failed" in message
        assert "agents.created_at" in message
        assert service._is_duplicate_manager_error(excinfo.value) is False
        await session.rollback()

    assert await count(sessions, Agent) == 0


@pytest.mark.asyncio
async def test_concurrent_worker_creation_creates_exactly_one_manager(
    sessions: SessionFactory,
) -> None:
    """Two workers created in parallel must share a single primary manager."""
    await seed_department(sessions)
    service = AgentService(JobTypeRegistry())

    async def create_worker(name: str) -> tuple[int, int]:
        async with sessions() as session:
            worker, manager = await service.create_worker_with_manager(
                session=session,
                name=name,
                job_type="web developer",
            )
            await session.commit()
            return worker.id, manager.id

    results = await asyncio.gather(create_worker("Racer A"), create_worker("Racer B"))

    assert len({manager_id for _, manager_id in results}) == 1, results
    assert await count(sessions, Agent, Agent.agent_type == AgentType.manager) == 1
    assert await count(sessions, Agent, Agent.agent_type == AgentType.worker) == 2


@pytest.mark.asyncio
async def test_concurrent_conflict_uses_the_integrity_error_recovery_path(
    sessions: SessionFactory,
) -> None:
    """Two real sessions through one race window recover via the handler.

    Both sessions read the manager list before either one inserts, so both
    attempt the insert and exactly one of them has to recover from the unique
    index violation. The pre-check reads are real database reads; they are only
    made to complete before either insert, which is the race the savepoint and
    the handler exist for.
    """
    await seed_department(sessions)
    service = AgentService(JobTypeRegistry())

    barrier = asyncio.Barrier(2)
    pre_checked: set[int] = set()
    recoveries: list[IntegrityError] = []

    real_lookup = service.primary_manager
    real_classify = service._is_duplicate_manager_error

    async def gated_lookup(session, department_id):
        if id(session) not in pre_checked:
            pre_checked.add(id(session))
            stale = await real_lookup(session, department_id)
            await asyncio.wait_for(barrier.wait(), timeout=10)
            return stale
        # Survivor lookup after a conflict: must not block on the barrier.
        return await real_lookup(session, department_id)

    def classify(exc: IntegrityError) -> bool:
        result = real_classify(exc)
        if result:
            recoveries.append(exc)
        return result

    service.primary_manager = gated_lookup
    service._is_duplicate_manager_error = classify

    async def create_worker(name: str) -> tuple[int, int]:
        async with sessions() as session:
            worker, manager = await service.create_worker_with_manager(
                session=session,
                name=name,
                job_type="web developer",
            )
            await session.commit()
            return worker.id, manager.id

    results = await asyncio.gather(create_worker("Racer A"), create_worker("Racer B"))

    assert len(recoveries) == 1, f"expected exactly one recovered conflict, got {len(recoveries)}"
    assert len(pre_checked) == 2, "both sessions should have run their pre-check"
    assert len({manager_id for _, manager_id in results}) == 1, results
    assert await count(sessions, Agent, Agent.agent_type == AgentType.manager) == 1
    assert await count(sessions, Agent, Agent.agent_type == AgentType.worker) == 2
    assert await count(
        sessions,
        Agent,
        Agent.agent_type == AgentType.manager,
        Agent.name == "Dev Manager (Primary)",
    ) == 1
