from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.agents.registry import get_task_service
from luma_core.db.session import get_db
from luma_core.models import Task, TaskStatus

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=512)
    description: str | None = Field(default=None, max_length=4096)
    job_type: str | None = Field(default=None, max_length=255)
    priority: int = Field(default=0, ge=-1000, le=1000)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    description: str | None = Field(default=None, max_length=4096)
    status: str | None = Field(default=None, max_length=32)
    priority: int | None = Field(default=None, ge=-1000, le=1000)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            TaskStatus(value)
        except ValueError:
            raise ValueError(
                f"Invalid status {value!r}. Allowed: {', '.join(e.value for e in TaskStatus)}"
            ) from None
        return value


class _TaskResponse(BaseModel):
    id: int
    title: str
    description: str | None
    job_type: str | None
    status: str
    priority: int
    result: str | None
    error: str | None
    department_id: int | None
    agent_id: int | None
    assignee_name: str | None
    created_at: str
    updated_at: str | None

    model_config = {"from_attributes": True}


def _serialize_task(task: Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "job_type": task.job_type,
        "status": task.status.value,
        "priority": task.priority,
        "result": task.result,
        "error": task.error,
        "department_id": task.department_id,
        "agent_id": task.agent_id,
        "assignee_name": task.assignee_name,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


@router.get("")
async def list_tasks(
    status: TaskStatus | None = None,
    department_id: int | None = None,
    assignee_id: int | None = None,
    limit: int = Query(default=100, le=500, ge=1),
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Task)
    if status is not None:
        stmt = stmt.where(Task.status == status)
    if department_id is not None:
        stmt = stmt.where(Task.department_id == department_id)
    if assignee_id is not None:
        stmt = stmt.where(Task.agent_id == assignee_id)
    stmt = stmt.order_by(Task.created_at.desc()).limit(limit)
    result = await session.execute(stmt)
    tasks: Sequence[Task] = result.scalars().all()
    return {
        "items": [_serialize_task(t) for t in tasks],
        "total": len(tasks),
    }


@router.post("", status_code=201, response_model=_TaskResponse)
async def create_task(
    payload: TaskCreate,
    session: AsyncSession = Depends(get_db),
) -> dict:
    now = _now_iso()
    task = Task(
        title=payload.title,
        description=payload.description,
        job_type=payload.job_type,
        priority=payload.priority,
        status=TaskStatus.pending,
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    await session.flush()

    if task.job_type:
        task_service = get_task_service()
        await task_service.assign_task(session=session, task=task, assigned_by_id=None)
        await session.refresh(task)

    return _serialize_task(task)


@router.get("/{task_id}", response_model=_TaskResponse)
async def get_task(
    task_id: int,
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Task).where(Task.id == task_id)
    result = await session.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Task not found")
    return _serialize_task(task)


@router.patch("/{task_id}", response_model=_TaskResponse)
async def update_task(
    task_id: int,
    payload: TaskUpdate,
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Task).where(Task.id == task_id)
    result = await session.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if payload.title is not None:
        task.title = payload.title
    if payload.description is not None:
        task.description = payload.description
    if payload.status is not None:
        new_status = TaskStatus(payload.status)
        try:
            task.set_status(new_status)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if payload.priority is not None:
        task.priority = payload.priority
    task.updated_at = _now_iso()
    await session.flush()
    await session.refresh(task)
    return _serialize_task(task)
