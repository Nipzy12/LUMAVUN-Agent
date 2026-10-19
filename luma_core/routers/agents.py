from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.agents.registry import get_agent_service
from luma_core.db.session import get_db
from luma_core.models import (
    Agent,
    AgentStatus,
    AgentType,
    AutonomyLevel,
    Department,
)

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    job_type: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    skills: list[str] | None = None
    autonomy_level: str | None = None


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    status: str | None = None
    autonomy_level: str | None = None
    skills: list[str] | None = None


class _AgentResponse(BaseModel):
    id: int
    name: str
    role: str | None
    description: str | None
    autonomy_level: str
    status: str
    agent_type: str
    skills: list[str]
    department_id: int | None
    department_name: str | None
    managed_department_id: int | None
    managed_department_name: str | None
    model_provider: str | None
    created_at: str
    updated_at: str | None

    model_config = {"from_attributes": True}


def _serialize_agent(agent: Agent) -> dict:
    managed = agent.managed_department
    return {
        "id": agent.id,
        "name": agent.name,
        "role": agent.role,
        "description": agent.description,
        "autonomy_level": agent.autonomy_level.value,
        "status": agent.status.value,
        "agent_type": agent.agent_type.value,
        "skills": agent.get_skills(),
        "department_id": agent.department_id,
        "department_name": agent.department.name if agent.department else None,
        "managed_department_id": agent.managed_department_id,
        "managed_department_name": managed.name if managed else None,
        "model_provider": agent.model_provider,
        "created_at": agent.created_at,
        "updated_at": agent.updated_at,
    }


@router.get("")
async def list_agents(
    department_id: int | None = None,
    agent_type: AgentType | None = None,
    status: AgentStatus | None = None,
    manager_only: bool = False,
    limit: int = Query(default=100, le=500, ge=1),
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Agent)
    if department_id is not None:
        stmt = stmt.where(Agent.department_id == department_id)
    if agent_type is not None:
        stmt = stmt.where(Agent.agent_type == agent_type)
    if status is not None:
        stmt = stmt.where(Agent.status == status)
    if manager_only:
        stmt = stmt.where(
            Agent.agent_type == AgentType.manager,
            Agent.managed_department_id.isnot(None),
        )
    stmt = stmt.order_by(Agent.name).limit(limit)
    result = await session.execute(stmt)
    agents: Sequence[Agent] = result.scalars().all()
    return {
        "items": [_serialize_agent(a) for a in agents],
        "total": len(agents),
    }


@router.post("", status_code=201, response_model=_AgentResponse)
async def create_agent(
    payload: AgentCreate,
    session: AsyncSession = Depends(get_db),
) -> dict:
    service = get_agent_service()

    worker, manager = await service.create_worker_with_manager(
        session=session,
        name=payload.name,
        job_type=payload.job_type,
        role=payload.description,
        description=payload.description,
        skills=payload.skills,
        autonomy_level=payload.autonomy_level,
    )
    await session.refresh(worker)
    return _serialize_agent(worker)


@router.get("/{agent_id}", response_model=_AgentResponse)
async def get_agent(
    agent_id: int,
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Agent).where(Agent.id == agent_id)
    result = await session.execute(stmt)
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _serialize_agent(agent)


@router.patch("/{agent_id}")
async def update_agent(
    agent_id: int,
    payload: AgentUpdate,
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Agent).where(Agent.id == agent_id)
    result = await session.execute(stmt)
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    if payload.name is not None:
        agent.name = payload.name
    if payload.description is not None:
        agent.description = payload.description
    if payload.status is not None:
        try:
            agent.status = AgentStatus(payload.status)
        except ValueError:
            pass
    if payload.autonomy_level is not None:
        try:
            agent.autonomy_level = AutonomyLevel(payload.autonomy_level)
        except ValueError:
            pass
    if payload.skills is not None:
        agent.set_skills(payload.skills)

    agent.updated_at = _now_iso()
    await session.flush()
    await session.refresh(agent)
    return _serialize_agent(agent)


@router.get("/{agent_id}/department")
async def get_agent_department(
    agent_id: int,
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Agent).where(Agent.id == agent_id)
    result = await session.execute(stmt)
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.department is None:
        raise HTTPException(status_code=404, detail="Agent has no department")
    department: Department = agent.department
    return {
        "id": department.id,
        "name": department.name,
        "description": department.description,
        "status": department.status.value,
    }
