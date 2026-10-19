from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.db.session import get_db
from luma_core.models import ApprovalRequest, ApprovalStatus

router = APIRouter(prefix="/api/approval-requests", tags=["approval"])


class _ApprovalRequestResponse(BaseModel):
    id: int
    status: str
    action: str
    actor_id: int | None
    target_type: str | None
    target_id: int | None
    reason: str | None
    requested_by: str | None
    reviewed_by: str | None
    review_note: str | None
    created_at: str
    updated_at: str | None

    model_config = {"from_attributes": True}


def _serialize(req: ApprovalRequest) -> dict:
    return {
        "id": req.id,
        "status": req.status.value,
        "action": req.action,
        "actor_id": req.actor_id,
        "target_type": req.target_type,
        "target_id": req.target_id,
        "reason": req.reason,
        "requested_by": req.requested_by,
        "reviewed_by": req.reviewed_by,
        "review_note": req.review_note,
        "created_at": req.created_at,
        "updated_at": req.updated_at,
    }


@router.get("")
async def list_approval_requests(
    status: ApprovalStatus | None = None,
    action: str | None = None,
    limit: int = Query(default=100, le=500, ge=1),
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(ApprovalRequest)
    if status is not None:
        stmt = stmt.where(ApprovalRequest.status == status)
    if action:
        stmt = stmt.where(ApprovalRequest.action == action)
    stmt = stmt.order_by(ApprovalRequest.created_at.desc()).limit(limit)
    result = await session.execute(stmt)
    requests: Sequence[ApprovalRequest] = result.scalars().all()
    return {
        "items": [_serialize(r) for r in requests],
        "total": len(requests),
    }


@router.get("/{request_id}", response_model=_ApprovalRequestResponse)
async def get_approval_request(
    request_id: int,
    session: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(ApprovalRequest).where(ApprovalRequest.id == request_id)
    result = await session.execute(stmt)
    req = result.scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Approval request not found")
    return _serialize(req)
