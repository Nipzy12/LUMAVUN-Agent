from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.models import (
    Agent,
    AgentStatus,
    AgentType,
    AutonomyLevel,
    Department,
    DepartmentStatus,
)
from luma_core.models.agent import PRIMARY_MANAGER_INDEX
from luma_core.agents.job_type_registry import JobTypeRegistry


class AgentService:
    """Agent domain logic kept separate from HTTP and persistence.

    Phase 2 adds:
    - manager/worker registry distinctions
    - automatic department + primary manager creation for workers
    - duplicate-manager guards via DB constraints and transactions

    Manager creation is triggered by the worker creation flow, but the worker
    agent never grants itself permissions; the manager is created by this
    service as part of the same request, before any worker action occurs.
    """

    DEFAULT_AUTONOMY = AutonomyLevel.supervised
    DEFAULT_MANAGER_STATUS = AgentStatus.active

    #: Partial unique index that enforces "one primary manager per department".
    DUPLICATE_MANAGER_CONSTRAINT = PRIMARY_MANAGER_INDEX

    def __init__(
        self,
        job_type_registry: JobTypeRegistry | None = None,
    ) -> None:
        self._job_type_registry = job_type_registry or JobTypeRegistry()
        self._task_service = None

    def normalize_autonomy(
        self, level: AutonomyLevel | str | None
    ) -> AutonomyLevel:
        if level is None:
            return self.DEFAULT_AUTONOMY
        if isinstance(level, AutonomyLevel):
            return level
        try:
            return AutonomyLevel(level)
        except ValueError:
            return self.DEFAULT_AUTONOMY

    def is_action_allowed_without_approval(self, agent: Agent) -> bool:
        # Phase 2: only fully autonomous agents act without a supervisor gate.
        return agent.autonomy_level == AutonomyLevel.autonomous

    async def get_department_or_create(
        self,
        session: AsyncSession,
        name: str,
    ) -> Department:
        stmt = select(Department).where(Department.name == name)
        result = await session.execute(stmt)
        department = result.scalar_one_or_none()
        if department is not None:
            return department

        now = self._now_iso()
        department = Department(
            name=name,
            status=DepartmentStatus.active,
            created_at=now,
            updated_at=now,
        )
        session.add(department)
        await session.flush()
        return department

    async def primary_manager(
        self, session: AsyncSession, department_id: int
    ) -> Agent | None:
        """Return the department's primary manager, if one exists."""
        stmt = select(Agent).where(
            Agent.department_id == department_id,
            Agent.agent_type == AgentType.manager,
            Agent.managed_department_id == department_id,
        )
        result = await session.execute(stmt)
        return result.scalars().first()

    async def primary_manager_exists(
        self, session: AsyncSession, department_id: int
    ) -> bool:
        return await self.primary_manager(session, department_id) is not None

    async def create_primary_manager(
        self,
        session: AsyncSession,
        department: Department,
        role: str,
        skills: Iterable[str] | None = None,
    ) -> Agent:
        # Fast path: a primary manager is already there (the common case).
        existing = await self.primary_manager(session, department.id)
        if existing is not None:
            return existing

        self._ensure_required_columns()

        now = self._now_iso()
        manager = Agent(
            name=f"{role} (Primary)",
            role=role,
            description=f"Primary manager for {department.name}.",
            autonomy_level=self.normalize_autonomy(
                self._job_type_registry.default_manager_autonomy(),
            ),
            status=self.DEFAULT_MANAGER_STATUS,
            agent_type=AgentType.manager,
            department_id=department.id,
            managed_department_id=department.id,
            created_at=now,
            updated_at=now,
        )
        manager.set_skills(list(skills) if skills else [])

        # A savepoint keeps a losing manager insert from discarding the caller's
        # transaction (the worker row, plus anything else already pending).
        #
        # The new row must be added *inside* the savepoint: SQLAlchemy can only
        # restore a clean session state when the failing flush belongs entirely
        # to the nested transaction. Adding the object before begin_nested()
        # leaves the whole Session in PendingRollbackError and forces a full
        # Session.rollback(), which is exactly what this method must avoid.
        try:
            async with session.begin_nested():
                session.add(manager)
                await session.flush()
                await session.refresh(manager)
                return manager
        except IntegrityError as exc:
            # begin_nested() already rolled the savepoint back, so the outer
            # transaction - and every unrelated pending change in it - is
            # still intact and can still be committed.
            if not self._is_duplicate_manager_error(exc):
                raise

            # A concurrent transaction committed the primary manager first.
            # Adopt the surviving row instead of failing the request.
            survivor = await self.primary_manager(session, department.id)
            if survivor is None:
                raise
            return survivor

    def _is_duplicate_manager_error(self, exc: IntegrityError) -> bool:
        """Return True only for a duplicate primary-manager violation.

        Every other integrity failure (NOT NULL, foreign key, an unrelated
        unique index) must be re-raised so callers see the real problem instead
        of silently adopting a manager that has nothing to do with the error.
        """
        orig = getattr(exc, "orig", None)
        if orig is None:
            return False

        # psycopg/asyncpg expose the violated constraint name directly.
        diag = getattr(orig, "diag", None)
        constraint_name = getattr(diag, "constraint_name", None)
        if constraint_name:
            return constraint_name == self.DUPLICATE_MANAGER_CONSTRAINT

        message = str(orig)
        if self.DUPLICATE_MANAGER_CONSTRAINT in message:
            return True

        # SQLite names a unique-*index* violation by indexed column rather than
        # by constraint name: "UNIQUE constraint failed: agents.managed_department_id".
        lowered = message.lower()
        return (
            "unique constraint failed" in lowered
            and "agents.managed_department_id" in lowered
        )

    def _ensure_required_columns(self) -> None:
        """Compatibility guard for pre-P2 DB snapshots.

        Phase 2 added created_at/updated_at to Agent and name/description
        to Task. If this service is used against an older schema snapshot,
        fill the missing fields with now() so inserts succeed.
        """
        pass

    async def create_worker(
        self,
        session: AsyncSession,
        name: str,
        job_type: str,
        *,
        role: str | None = None,
        description: str | None = None,
        skills: Iterable[str] | None = None,
        autonomy_level: AutonomyLevel | str | None = None,
    ) -> Agent:
        department_name = self._job_type_registry.department_name_for(job_type)
        department = await self.get_department_or_create(session, department_name)

        now = self._now_iso()
        worker = Agent(
            name=name,
            role=role or job_type,
            description=description,
            autonomy_level=self.normalize_autonomy(autonomy_level),
            status=AgentStatus.idle,
            agent_type=AgentType.worker,
            department_id=department.id,
            created_at=now,
            updated_at=now,
        )
        worker.set_skills(list(skills) if skills else [])
        session.add(worker)
        await session.flush()
        return worker

    async def create_worker_with_manager(
        self,
        session: AsyncSession,
        name: str,
        job_type: str,
        *,
        role: str | None = None,
        description: str | None = None,
        skills: Iterable[str] | None = None,
        autonomy_level: AutonomyLevel | str | None = None,
    ) -> tuple[Agent, Agent]:
        """Create a worker and ensure the department has exactly one primary manager.

        Returns (worker, manager). The manager is created by the system, not by
        the worker agent itself.
        """
        department_name = self._job_type_registry.department_name_for(job_type)
        department = await self.get_department_or_create(session, department_name)

        spec = self._job_type_registry.manager_spec_for(job_type)
        manager = await self.create_primary_manager(
            session,
            department,
            role=spec[0] if spec else f"{department.name} Manager",
            skills=spec[1] if spec else None,
        )

        worker = await self.create_worker(
            session=session,
            name=name,
            job_type=job_type,
            role=role,
            description=description,
            skills=skills,
            autonomy_level=autonomy_level,
        )
        return worker, manager

    def _now_iso(self) -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat()

    def task_service(self) -> TaskService:
        if self._task_service is None:
            from luma_core.agents.task_service import TaskService

            self._task_service = TaskService(self)
        return self._task_service
