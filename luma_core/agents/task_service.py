from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.models import Agent, AgentStatus, AgentType, Task, TaskStatus


class TaskService:
    """Deterministic Phase 2 task routing.

    - Resolve department from task job_type via the agent/job-type registry.
    - Assign to the most suitable worker in that department, or leave unassigned.
    - Record assignment history on the task.
    """

    def __init__(self, agent_service) -> None:
        self._agent_service = agent_service

    async def find_suitable_worker(
        self,
        session: AsyncSession,
        department_id: int,
        requested_skills: Iterable[str] | None = None,
    ) -> Agent | None:
        requested = [str(s).lower() for s in requested_skills or []]
        stmt = (
            select(Agent)
            .where(
                Agent.department_id == department_id,
                Agent.agent_type == AgentType.worker,
                Agent.status.in_([AgentStatus.active, AgentStatus.idle]),
            )
            .order_by(Agent.id)
        )
        result = await session.execute(stmt)
        workers = list(result.scalars().all())
        if not workers:
            return None
        if not requested:
            return workers[0]

        def score(worker: Agent) -> tuple[int, int]:
            worker_skills = [s.lower() for s in worker.get_skills()]
            matches = sum(1 for skill in requested if skill in worker_skills)
            return (-matches, worker.id)

        workers.sort(key=score)
        best = workers[0]
        if best.get_skills() or requested:
            return best
        return workers[0]

    async def record_assignment(
        self,
        session: AsyncSession,
        task: Task,
        assigned_by_id: int | None,
        assigned_to_id: int | None,
        reason: str | None = None,
    ) -> None:
        from luma_core.models.assignment_history import (
            AssignmentAction,
            AssignmentHistory,
        )

        now = _now_iso()
        action = (
            AssignmentAction.assigned.value
            if assigned_to_id
            else AssignmentAction.unassigned.value
        )
        history = AssignmentHistory(
            task_id=task.id,
            action=action,
            assigned_by_id=assigned_by_id,
            assigned_to_id=assigned_to_id,
            reason=reason,
            occurred_at=now,
        )
        session.add(history)

    async def assign_task(
        self,
        session: AsyncSession,
        task: Task,
        assigned_by_id: int | None,
    ) -> Agent | None:
        from luma_core.agents.registry import get_agent_service

        agent_service = get_agent_service()

        from luma_core.models import Department

        # Resolve department from task job_type if not already set.
        if not task.department_id and task.job_type:
            department_name = (
                agent_service._job_type_registry.department_name_for(task.job_type)
            )
            from sqlalchemy import select

            stmt = select(Department).where(Department.name == department_name)
            result = await session.execute(stmt)
            department = result.scalar_one_or_none()
            if department is not None:
                task.department_id = department.id

        if not task.department_id:
            await self.record_assignment(
                session,
                task,
                assigned_by_id=assigned_by_id,
                assigned_to_id=None,
                reason="No department resolved for task",
            )
            return None

        requested_skills = None
        worker = await self.find_suitable_worker(
            session, task.department_id, requested_skills
        )
        if worker is None:
            await self.record_assignment(
                session,
                task,
                assigned_by_id=assigned_by_id,
                assigned_to_id=None,
                reason="No suitable worker in department",
            )
            return None

        task.agent_id = worker.id
        task.status = TaskStatus.in_progress
        task.updated_at = _now_iso()
        await session.flush()
        await self.record_assignment(
            session,
            task,
            assigned_by_id=assigned_by_id,
            assigned_to_id=worker.id,
            reason="Deterministic best-fit worker selection",
        )
        return worker


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
