"""Owner-only opt-in fictional-adult workspace; never part of ordinary Chat history."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
import secrets
from pathlib import Path
from uuid import UUID, uuid4
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.auth import get_owner_identity
from luma_core.config import get_settings
from luma_core.db.session import get_db
from luma_core.memory.conversations import now
from luma_core.memory.studio_privacy import private_owner
from luma_core.models import (
    StudioWorkspace,
    StudioUnlock,
    StudioAttachment,
    Conversation,
    ConversationMessage,
    ChatAttachment,
    ImageAsset,
    ImageJob,
    StudioExecution,
)
from luma_core.routers import studio, images, chat

router = APIRouter(prefix="/api/private-studio", tags=["private-studio"])


class Eligibility(BaseModel):
    model_config = ConfigDict(extra="forbid")
    adult_eligible: StrictBool
    fictional_adults_only: StrictBool
    accept_law_license_provider_policies: StrictBool


@router.post("/unlock")
async def unlock(
    payload: Eligibility,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    if not get_settings().private_studio_enabled:
        raise HTTPException(404, "Private Studio disabled")
    if not all(payload.model_dump().values()):
        raise HTTPException(403, "Adult eligibility and policy attestation required")
    await session.execute(
        delete(StudioUnlock).where(
            StudioUnlock.owner == owner, StudioUnlock.expires_at <= now()
        )
    )
    token = secrets.token_urlsafe(32)
    expires = (
        datetime.now(timezone.utc)
        + timedelta(minutes=get_settings().private_studio_unlock_minutes)
    ).isoformat()
    session.add(
        StudioUnlock(
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            owner=owner,
            expires_at=expires,
        )
    )
    await session.flush()
    return {
        "session_token": token,
        "expires_at": expires,
        "valid_for_seconds": get_settings().private_studio_unlock_minutes * 60,
        "notice": "Self-attestation is not formal age verification. Private access does not override law, consent, model licenses or provider policies.",
    }


@router.post("/lock")
async def lock(
    owner=Depends(get_owner_identity), session: AsyncSession = Depends(get_db)
):
    await session.execute(delete(StudioUnlock).where(StudioUnlock.owner == owner))
    return {"locked": True}


async def access(
    owner=Depends(get_owner_identity),
    x_luma_studio_session: str | None = Header(default=None),
    session: AsyncSession = Depends(get_db),
):
    if not get_settings().private_studio_enabled:
        raise HTTPException(404, "Private Studio disabled")
    row = await session.get(
        StudioUnlock, hashlib.sha256((x_luma_studio_session or "").encode()).hexdigest()
    )
    if not row or row.owner != owner or row.expires_at <= now():
        raise HTTPException(423, "Private Studio locked")
    marker = private_owner.set(owner)
    try:
        yield owner
    finally:
        private_owner.reset(marker)


async def workspace(session, conversation_id, owner):
    row = await session.scalar(
        select(StudioWorkspace)
        .where(StudioWorkspace.conversation_id == str(conversation_id))
        .execution_options(populate_existing=True)
    )
    if not row or row.owner != owner or not row.private or row.deleted:
        raise HTTPException(404, "Private workspace not found")
    return row


@router.get("/catalog")
async def catalog(
    engine: Literal["cloud", "comfy_local", "comfy_remote"] = "comfy_local",
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    return await studio.catalog_data(engine, owner, session)


@router.get("/presets")
async def presets(owner=Depends(access), session: AsyncSession = Depends(get_db)):
    return await studio.presets(owner, session)


@router.post("/presets", status_code=201)
async def preset(
    payload: studio.PresetInput,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    return await studio.save_preset(payload, owner, session)


@router.post("/workspaces", status_code=201)
async def create(owner=Depends(access), session: AsyncSession = Depends(get_db)):
    identifier = str(uuid4())
    timestamp = now()
    session.add(
        Conversation(
            id=identifier,
            owner_identity=owner,
            title="Private artwork",
            created_at=timestamp,
            updated_at=timestamp,
        )
    )
    await session.flush()
    session.add(
        StudioWorkspace(
            conversation_id=identifier,
            owner=owner,
            private=True,
            gallery_visible=True,
            deleted=False,
        )
    )
    await session.flush()
    return {"id": identifier}


@router.get("/workspaces")
async def gallery(
    include_hidden: bool = False,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    stmt = select(StudioWorkspace).where(
        StudioWorkspace.owner == owner,
        StudioWorkspace.private.is_(True),
        StudioWorkspace.deleted.is_(False),
    )
    if not include_hidden:
        stmt = stmt.where(StudioWorkspace.gallery_visible.is_(True))
    rows = (await session.scalars(stmt)).all()
    return {
        "items": [
            {"id": r.conversation_id, "gallery_visible": r.gallery_visible}
            for r in rows
        ]
    }


class Visibility(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gallery_visible: StrictBool


@router.patch("/workspaces/{conversation_id}")
async def visibility(
    conversation_id: UUID,
    payload: Visibility,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    row = await workspace(session, conversation_id, owner)
    row.gallery_visible = payload.gallery_visible
    await session.flush()
    return {"gallery_visible": row.gallery_visible}


@router.get("/workspaces/{conversation_id}")
async def detail(
    conversation_id: UUID,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    await workspace(session, conversation_id, owner)
    data = await images.history(conversation_id, owner, session)
    messages = (
        await session.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == str(conversation_id))
            .order_by(ConversationMessage.id)
        )
    ).all()
    return {
        **data,
        "messages": [
            {"id": m.id, "role": m.role, "content": m.content} for m in messages
        ],
    }


@router.post("/workspaces/{conversation_id}/uploads", status_code=201)
async def upload(
    conversation_id: UUID,
    request: Request,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    await workspace(session, conversation_id, owner)
    if request.headers.get("content-type", "").split(";")[0] not in (
        "image/png",
        "image/jpeg",
        "image/webp",
    ):
        raise HTTPException(422, "Private reference/mask must be a raster image")
    data = await chat.upload(request, owner, session)
    try:
        await workspace(session, conversation_id, owner)
    except HTTPException:
        # A deleted workspace cannot gain late uploads after its purge. This file
        # belongs only to the current uncommitted upload and has no external refs.
        path = Path(get_settings().chat_attachment_dir).resolve() / data["id"]
        if path.is_file() and not path.is_symlink():
            path.unlink()
        raise
    row = await session.get(ChatAttachment, data["id"])
    row.conversation_id = str(conversation_id)
    session.add(
        StudioAttachment(attachment_id=row.id, conversation_id=str(conversation_id))
    )
    await session.flush()
    return data


@router.get("/uploads/{attachment_id}")
async def retrieve_upload(
    attachment_id: UUID, owner=Depends(access), session: AsyncSession = Depends(get_db)
):
    scope = await session.get(StudioAttachment, str(attachment_id))
    if not scope:
        raise HTTPException(404, "Private reference not found")
    await workspace(session, scope.conversation_id, owner)
    return await chat.retrieve(attachment_id, owner, session)


@router.get("/assets/{asset_id}")
async def retrieve(
    asset_id: UUID,
    download: bool = False,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    row = await session.get(ImageAsset, str(asset_id))
    if not row:
        raise HTTPException(404, "Private image not found")
    await workspace(session, row.conversation_id, owner)
    return await images.retrieve(asset_id, download, owner, session)


@router.post("/workspaces/{conversation_id}/generate")
async def generate(
    conversation_id: UUID,
    payload: studio.StudioInput,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
    x_luma_studio_session: str | None = Header(default=None),
):
    await workspace(session, conversation_id, owner)
    for identifier in (payload.reference_attachment_id, payload.mask_attachment_id):
        if identifier:
            row = await session.get(StudioAttachment, str(identifier))
            if not row or row.conversation_id != str(conversation_id):
                raise HTTPException(404, "Private reference/mask not found")
    payload = payload.model_copy(deep=True)
    if x_luma_studio_session:
        payload.prompt = payload.prompt.replace(x_luma_studio_session, "[REDACTED]")
        payload.negative_prompt = payload.negative_prompt.replace(
            x_luma_studio_session, "[REDACTED]"
        )
    return await studio.generate(conversation_id, payload, owner, session)


@router.get("/jobs/{job_id}")
async def status(
    job_id: UUID, owner=Depends(access), session: AsyncSession = Depends(get_db)
):
    job = await session.get(ImageJob, str(job_id))
    if not job:
        raise HTTPException(404, "Private job not found")
    await workspace(session, job.conversation_id, owner)
    return await studio.job_status(job_id, owner, session)


@router.post("/jobs/{job_id}/cancel")
async def cancel(
    job_id: UUID, owner=Depends(access), session: AsyncSession = Depends(get_db)
):
    job = await session.get(ImageJob, str(job_id))
    if not job:
        raise HTTPException(404, "Private job not found")
    await workspace(session, job.conversation_id, owner)
    return await studio.cancel(job_id, owner, session)


@router.post("/jobs/{job_id}/recover")
async def recover(
    job_id: UUID, owner=Depends(access), session: AsyncSession = Depends(get_db)
):
    job = await session.get(ImageJob, str(job_id))
    if not job:
        raise HTTPException(404, "Private job not found")
    await workspace(session, job.conversation_id, owner)
    return await studio.recover(job_id, owner, session)


class DeleteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_delete: StrictBool


@router.delete("/workspaces/{conversation_id}")
async def remove(
    conversation_id: UUID,
    payload: DeleteInput,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    if not payload.confirm_delete:
        raise HTTPException(422, "Explicit deletion confirmation required")
    row = await workspace(session, conversation_id, owner)
    row.deleted = True
    row.gallery_visible = False
    await session.execute(
        update(ImageJob)
        .where(
            ImageJob.conversation_id == str(conversation_id),
            ImageJob.provider_active.is_(True),
        )
        .values(status="cancelled")
    )
    return {"deleted": True, "purge_required": True}


@router.post("/purge")
async def purge(owner=Depends(access), session: AsyncSession = Depends(get_db)):
    # Explicit owner deletion only, never retention of existing/public conversation data.
    # Read-only reconciliation before acquiring the writer lock: an old monitor
    # may have died after deletion. Never resubmit, interrupt or fetch image data.
    candidates = (
        await session.execute(
            select(
                ImageJob.id,
                StudioExecution.engine,
                StudioExecution.remote_id,
                StudioExecution.parameters,
            )
            .join(StudioExecution, StudioExecution.job_id == ImageJob.id)
            .join(
                StudioWorkspace,
                StudioWorkspace.conversation_id == ImageJob.conversation_id,
            )
            .where(
                StudioWorkspace.owner == owner,
                ImageJob.owner == owner,
                StudioWorkspace.private.is_(True),
                StudioWorkspace.deleted.is_(True),
                ImageJob.status == "cancelled",
                ImageJob.provider_active.is_(True),
            )
        )
    ).all()
    await session.rollback()  # Release read locks before remote status checks.
    ended = []
    for identifier, engine, remote_id, parameters in candidates:
        if not remote_id:
            continue
        try:
            backend = studio.ComfyUI(get_settings(), engine)
            if (
                json.loads(parameters).get("endpoint_hash")
                != hashlib.sha256(backend.url.encode()).hexdigest()
            ):
                continue
            history = await backend.history(remote_id)
            if (
                history
                and (
                    history.get("status", {}).get("completed")
                    or history.get("status", {}).get("status_str") == "error"
                )
            ) or not await backend.active(remote_id):
                ended.append(identifier)
        except Exception:
            continue  # Unreachable/uncertain engines retain their files and slot.

    await session.execute(
        update(StudioWorkspace)
        .where(StudioWorkspace.conversation_id == "")
        .values(deleted=StudioWorkspace.deleted)
    )
    for identifier in ended:
        await session.execute(
            update(ImageJob)
            .where(ImageJob.id == identifier, ImageJob.status == "cancelled")
            .values(provider_active=False)
        )
        await session.execute(
            update(StudioExecution)
            .where(StudioExecution.job_id == identifier)
            .values(stage="finished")
        )
    rows = (
        await session.scalars(
            select(StudioWorkspace).where(
                StudioWorkspace.owner == owner,
                StudioWorkspace.private.is_(True),
                StudioWorkspace.deleted.is_(True),
            )
        )
    ).all()
    removed = 0
    pending = 0
    for row in rows:
        cid = row.conversation_id
        if await session.scalar(
            select(ImageJob.id).where(
                ImageJob.conversation_id == cid, ImageJob.provider_active.is_(True)
            )
        ):
            pending += 1
            continue
        assets = (
            await session.scalars(
                select(ImageAsset).where(ImageAsset.conversation_id == cid)
            )
        ).all()
        uploads = (
            await session.scalars(
                select(StudioAttachment).where(StudioAttachment.conversation_id == cid)
            )
        ).all()
        complete = True
        for identifier, folder, is_upload in [
            (a.id, images.root(), False) for a in assets
        ] + [
            (u.attachment_id, Path(get_settings().chat_attachment_dir).resolve(), True)
            for u in uploads
        ]:
            try:
                if str(UUID(identifier)) != identifier:
                    complete = False
                    continue
                linked = await session.scalar(
                    select(ImageAsset.id).where(
                        ImageAsset.conversation_id != cid,
                        (ImageAsset.source_attachment_id == identifier)
                        if is_upload
                        else (ImageAsset.parent_id == identifier),
                    )
                )
                if linked:
                    complete = False
                    continue
                path = folder / identifier
                if path.is_symlink():
                    complete = False
                    continue
                if path.exists():
                    path.unlink()
                    removed += 1
            except (ValueError, OSError):
                complete = False
        if complete:
            await session.execute(
                update(ConversationMessage)
                .where(ConversationMessage.conversation_id == cid)
                .values(content="")
            )
            await session.execute(
                update(Conversation)
                .where(Conversation.id == cid)
                .values(title="Deleted private workspace")
            )
            for upload in uploads:
                await session.execute(
                    update(ChatAttachment)
                    .where(ChatAttachment.id == upload.attachment_id)
                    .values(name="Deleted private attachment", text="")
                )
        else:
            pending += 1
    return {
        "files_removed": removed,
        "workspaces_pending": pending,
        "notice": "Local purge only; backups and trusted remote engine storage require operator retention controls.",
    }


@router.put("/default-model")
async def set_default(
    payload: studio.DefaultModel,
    owner=Depends(access),
    session: AsyncSession = Depends(get_db),
):
    return await studio.set_default(payload, owner, session)
