from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.auth import get_owner_token, get_owner_identity, optional_owner_identity
from luma_core.memory.conversations import approval_visibility, require_task_access
from luma_core.db.session import get_db
from luma_core.governance.policy import GovernancePolicy
from luma_core.models import ApprovalRequest, ApprovalStatus

router = APIRouter(prefix="/api/approval-requests", tags=["approval"])

# Module-level policy instance used for decision logging.
_policy = GovernancePolicy()


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


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
    owner: str | None = Depends(optional_owner_identity),
) -> dict:
    stmt = select(ApprovalRequest).where(approval_visibility(ApprovalRequest.target_type, ApprovalRequest.target_id, owner))
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
    owner: str | None = Depends(optional_owner_identity),
) -> dict:
    stmt = select(ApprovalRequest).where(approval_visibility(ApprovalRequest.target_type, ApprovalRequest.target_id, owner)).where(ApprovalRequest.id == request_id)
    result = await session.execute(stmt)
    req = result.scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Approval request not found")
    return _serialize(req)


class ApprovalRequestCreate(BaseModel):
    action: str = Field(min_length=1, max_length=255)
    target_type: str | None = Field(default=None, max_length=128)
    target_id: int | None = None
    reason: str | None = Field(default=None, max_length=4096)


class ApprovalDecision(BaseModel):
    note: str | None = None


@router.post("", status_code=201, response_model=_ApprovalRequestResponse)
async def create_approval_request(
    payload: ApprovalRequestCreate,
    session: AsyncSession = Depends(get_db),
    token: str = Depends(get_owner_token),
    owner: str = Depends(get_owner_identity),
) -> dict:
    """Create an approval request for a sensitive action.

    Requires owner authentication. The authenticated owner identity is recorded
    in the audit log, never a hardcoded label for unauthenticated requests.
    """
    if payload.target_type == 'task' and payload.target_id is not None:
        await require_task_access(session, payload.target_id, owner)
    now = _now_iso()
    req = ApprovalRequest(
        action=payload.action,
        target_type=payload.target_type,
        target_id=payload.target_id,
        reason=payload.reason,
        requested_by="local-owner",
        created_at=now,
        updated_at=now,
    )
    session.add(req)
    await session.flush()
    await session.refresh(req)

    _policy.record_audit(
        session,
        action="approval_requested",
        actor="local-owner",
        target_type="approval_request",
        target_id=req.id,
        summary=f"Approval request created for {payload.action}.",
        metadata_={"target_type": payload.target_type, "target_id": payload.target_id},
    )
    await session.commit()
    await session.refresh(req)
    return _serialize(req)


@router.post("/{request_id}/approve", status_code=200, response_model=None)
async def approve_request(
    request_id: int,
    payload: ApprovalDecision | None = None,
    session: AsyncSession = Depends(get_db),
    token: str = Depends(get_owner_token),
    owner: str = Depends(get_owner_identity),
) -> dict:
    """Owner-only approval of a pending approval request.

    Non-owners receive 401; requests that are not pending receive 400.
    """
    stmt = select(ApprovalRequest).where(ApprovalRequest.id == request_id)
    result = await session.execute(stmt)
    req = result.scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if req.target_type == 'task' and req.target_id is not None:
        await require_task_access(session, req.target_id, owner)
    if req.status != ApprovalStatus.pending:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve request in status {req.status.value!r}.",
        )

    decision = await session.execute(update(ApprovalRequest).where(
        ApprovalRequest.id == request_id,
        ApprovalRequest.status == ApprovalStatus.pending,
    ).values(status=ApprovalStatus.approved, reviewed_by="local-owner",
             review_note=payload.note if payload else None, updated_at=_now_iso())
      .execution_options(synchronize_session=False))
    if decision.rowcount != 1:
        raise HTTPException(400, "Approval request has already been reviewed")
    await session.refresh(req)

    # Audit the approval decision.
    _policy.record_audit(
        session,
        action="approval_granted",
        actor="local-owner",
        target_type="approval_request",
        target_id=req.id,
        summary=f"Owner approved request #{req.id} for {req.action}.",
        metadata_={"note": req.review_note},
    )
    await session.commit()
    await session.refresh(req)
    return _serialize(req)


@router.post("/{request_id}/deny", status_code=200, response_model=None)
async def deny_request(
    request_id: int,
    payload: ApprovalDecision | None = None,
    session: AsyncSession = Depends(get_db),
    token: str = Depends(get_owner_token),
    owner: str = Depends(get_owner_identity),
) -> dict:
    """Owner-only denial of a pending approval request."""
    stmt = select(ApprovalRequest).where(ApprovalRequest.id == request_id)
    result = await session.execute(stmt)
    req = result.scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if req.target_type == 'task' and req.target_id is not None:
        await require_task_access(session, req.target_id, owner)
    if req.status != ApprovalStatus.pending:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot deny request in status {req.status.value!r}.",
        )

    decision = await session.execute(update(ApprovalRequest).where(
        ApprovalRequest.id == request_id,
        ApprovalRequest.status == ApprovalStatus.pending,
    ).values(status=ApprovalStatus.denied, reviewed_by="local-owner",
             review_note=payload.note if payload else None, updated_at=_now_iso())
      .execution_options(synchronize_session=False))
    if decision.rowcount != 1:
        raise HTTPException(400, "Approval request has already been reviewed")
    await session.refresh(req)

    _policy.record_audit(
        session,
        action="approval_denied",
        actor="local-owner",
        target_type="approval_request",
        target_id=req.id,
        summary=f"Owner denied request #{req.id} for {req.action}.",
        metadata_={"note": req.review_note},
    )
    await session.commit()
    await session.refresh(req)
    return _serialize(req)
