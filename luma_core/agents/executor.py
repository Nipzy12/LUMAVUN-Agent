"""Explicit owner execution with an atomic claim and durable lifecycle."""
import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import update, select
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.config import get_settings
from luma_core.agents.prompts import AgentContext, build_task_prompt
from luma_core.providers.prompts import redact_secrets
from luma_core.providers.registry import create_registry
from luma_core.providers.base import BaseModelProvider
from luma_core.governance.policy import GovernancePolicy
from luma_core.models import Task, TaskStatus, ApprovalRequest, ApprovalStatus


def get_execution_provider() -> BaseModelProvider:
    return create_registry(get_settings()).get()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def execute_task(session: AsyncSession, task_id: int, approval_id: int,
                       provider: BaseModelProvider) -> Task:
    policy = GovernancePolicy()
    # The conditional write both validates and consumes approval. Never rely on
    # an ORM object read before another transaction may change its status.
    consumed = await session.execute(update(ApprovalRequest).where(
        ApprovalRequest.id == approval_id,
        ApprovalRequest.status == ApprovalStatus.approved,
        ApprovalRequest.action == 'execute_task',
        ApprovalRequest.target_type == 'task',
        ApprovalRequest.target_id == task_id,
        ApprovalRequest.reviewed_by == 'local-owner',
    ).values(status=ApprovalStatus.cancelled,
             review_note='Consumed by explicit owner execution', updated_at=now()))
    if consumed.rowcount != 1:
        policy.record_audit(session, 'policy_denied', actor='local-owner',
                            target_type='task', target_id=task_id)
        await session.commit()
        raise HTTPException(403, 'An owner-approved execute_task request for this task is required')
    if not provider.is_available:
        await session.rollback()
        raise HTTPException(503, 'Configure a cloud AI provider before execution')
    claim = await session.execute(update(Task).where(
        Task.id == task_id, Task.status == TaskStatus.assigned, Task.agent_id.is_not(None)
    ).values(status=TaskStatus.in_progress, result=None, error=None, updated_at=now()))
    if claim.rowcount != 1:
        await session.rollback()
        raise HTTPException(409, 'Task must be assigned to a worker and not already executing')
    policy.record_audit(session, 'task_execution_started', actor='local-owner',
                        target_type='task', target_id=task_id,
                        metadata_={'approval_id': approval_id})
    await session.commit()  # release SQLite lock before the network call
    task = await session.get(Task, task_id)
    try:
        assigned_agent = task.agent
        agent_context = None
        if assigned_agent is not None:
            agent_context = AgentContext(
                name=assigned_agent.name,
                role=assigned_agent.role,
                skills=tuple(assigned_agent.get_skills()),
                department=assigned_agent.department.name if assigned_agent.department else None,
            )
        prompt = build_task_prompt(task.title, task.description, agent_context)
        response = await asyncio.wait_for(
            provider.chat(prompt),
            timeout=get_settings().ai_timeout_seconds,
        )
        if not isinstance(response.text, str) or not response.text.strip():
            raise ValueError('Empty response')
        result, error, status = redact_secrets(response.text, get_settings()), None, TaskStatus.completed
    except Exception:
        result, error, status = None, 'AI execution failed; check provider configuration or retry with a new approval.', TaskStatus.failed
    finished = await session.execute(update(Task).where(
        Task.id == task_id, Task.status == TaskStatus.in_progress
    ).values(status=status, result=result, error=error, updated_at=now()))
    action = f'task_execution_{status.value}' if finished.rowcount else 'task_execution_discarded'
    policy.record_audit(session, action, actor='local-owner',
                        target_type='task', target_id=task_id,
                        metadata_={'approval_id': approval_id})
    await session.commit()
    return (await session.execute(select(Task).where(Task.id == task_id)
                                  .execution_options(populate_existing=True))).scalar_one()
