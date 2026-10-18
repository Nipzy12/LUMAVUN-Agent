from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.db.session import get_db
from luma_core.models import Department, DepartmentStatus
from luma_core.schemas import DepartmentCreate, DepartmentResponse, DepartmentUpdate

router = APIRouter(prefix="/api/departments", tags=["departments"])


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _serialize(dep: Department) -> dict:
    return {
        "id": dep.id,
        "name": dep.name,
        "description": dep.description,
        "status": dep.status.value,
        "agent_count": len(dep.agents),
        "created_at": dep.created_at,
        "updated_at": dep.updated_at,
    }


class DepartmentCreate(BaseModel):
    name: str
    description: str | None = None
    status: str = "active"


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None


class _DepartmentResponse(BaseModel):
    id: int
    name: str
    description: str | None
    status: str
    agent_count: int
    created_at: str
    updated_at: str | None

    model_config = {"from_attributes": True}


@router.get("")
async def list_departments(
    status: DepartmentStatus | None = None,
    limit: int = Query(default=100, le=500, ge=1),
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Department)
    if status is not None:
        stmt = stmt.where(Department.status == status)
    stmt = stmt.order_by(Department.name).limit(limit)
    result = await session.execute(stmt)
    departments: Sequence[Department] = result.scalars().all()
    return {
        "items": [_serialize(d) for d in departments],
        "total": len(departments),
    }


@router.post("", status_code=201, response_model=_DepartmentResponse)
async def create_department(
    payload: DepartmentCreate,
    session: AsyncSession = Depends(get_db),
) -> dict:
    department_status: DepartmentStatus
    try:
        department_status = DepartmentStatus(payload.status)
    except ValueError:
        department_status = DepartmentStatus.active

    now = _now_iso()
    department = Department(
        name=payload.name,
        description=payload.description,
        status=department_status,
        created_at=now,
        updated_at=now,
    )
    session.add(department)
    await session.flush()
    await session.refresh(department)
    return _serialize(department)


@router.get("/{department_id}", response_model=_DepartmentResponse)
async def get_department(
    department_id: int,
    session: AsyncSession = Depends(get_db),
) -> dict:
    result = await session.get(Department, department_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return _serialize(result)


@router.patch("/{department_id}")
async def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    session: AsyncSession = Depends(get_db),
) -> dict:
    department = await session.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")

    if payload.name is not None:
        department.name = payload.name
    if payload.description is not None:
        department.description = payload.description
    if payload.status is not None:
        try:
            department.status = DepartmentStatus(payload.status)
        except ValueError:
            pass
    department.updated_at = _now_iso()

    await session.flush()
    await session.refresh(department)
    return _serialize(department)


@router.delete("/{department_id}", status_code=204)
async def delete_department(
    department_id: int,
    session: AsyncSession = Depends(get_db),
) -> None:
    department = await session.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")
    await session.delete(department)
