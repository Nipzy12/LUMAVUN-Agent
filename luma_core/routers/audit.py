from typing import Sequence

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.db.session import get_db
from luma_core.models import AuditEvent

router = APIRouter(prefix="/api/audit-events", tags=["audit"])


class _AuditEventResponse(BaseModel):
    id: int
    occurred_at: str
    action: str
    actor: str | None
    target_type: str | None
    target_id: int | None
    summary: str | None
    metadata_: str | None

    model_config = {"from_attributes": True}


def _serialize(event: AuditEvent) -> dict:
    return {
        "id": event.id,
        "occurred_at": event.occurred_at,
        "action": event.action,
        "actor": event.actor,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "summary": event.summary,
        "metadata_": event.metadata_,
    }


@router.get("")
async def list_audit_events(
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    limit: int = Query(default=100, le=500, ge=1),
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(AuditEvent)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if actor:
        stmt = stmt.where(AuditEvent.actor == actor)
    stmt = stmt.order_by(AuditEvent.occurred_at.desc()).limit(limit)
    result = await session.execute(stmt)
    events: Sequence[AuditEvent] = result.scalars().all()
    return {
        "items": [_serialize(e) for e in events],
        "total": len(events),
    }
