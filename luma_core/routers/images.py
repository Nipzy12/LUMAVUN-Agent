"""Explicit image generation, immutable revisions and private retrieval. No Work execution."""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.auth import get_owner_identity
from luma_core.config import get_settings
from luma_core.db.session import get_db
from luma_core.governance.policy import GovernancePolicy
from luma_core.memory.attachments import parse_attachment
from luma_core.memory.conversations import now
from luma_core.models import (
    ChatAttachment,
    ChatRequest,
    Conversation,
    ConversationMessage,
    ImageAsset,
    ImageJob,
    Task,
    TaskStatus,
)
from luma_core.providers.images import (
    MODELS,
    ImageProvider,
    ImageProviderError,
    ImageExecutionPending,
    safe_usage,
)
from luma_core.providers.prompts import redact_secrets
from luma_core.routers.conversations import owned
from luma_core.memory.studio_privacy import guard_conversation

router = APIRouter(prefix="/api/images", tags=["image-studio"])


def get_image_provider():
    return ImageProvider(get_settings())


def root():
    return Path(get_settings().image_storage_dir).resolve()


def asset_json(asset):
    return {
        key: getattr(asset, key)
        for key in (
            "id",
            "conversation_id",
            "parent_id",
            "source_attachment_id",
            "job_id",
            "message_id",
            "mime",
            "created_at",
        )
    }


async def job_json(session, job):
    assets = (
        await session.scalars(
            select(ImageAsset)
            .where(ImageAsset.job_id == job.id)
            .order_by(ImageAsset.id)
        )
    ).all()
    return {
        "id": job.id,
        "conversation_id": job.conversation_id,
        "status": job.status,
        "model": job.model,
        "client_message_id": job.client_id,
        "provider_active": job.provider_active,
        "error": job.error,
        "usage": json.loads(job.usage),
        "assets": [asset_json(a) for a in assets],
    }


class GenerateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_message_id: UUID
    prompt: str = Field(min_length=1, max_length=4000)
    model: str = Field(min_length=1, max_length=128)
    quality: Literal["low", "medium", "high"] = "medium"
    aspect_ratio: Literal["1:1", "16:9", "9:16"] = "1:1"
    n: int = Field(default=1, ge=1, le=4)
    parent_id: UUID | None = None
    reference_attachment_id: UUID | None = None

    @model_validator(mode="after")
    def validate_references(self):
        if self.parent_id and self.reference_attachment_id:
            raise ValueError("Choose one reference")
        if not self.prompt.strip():
            raise ValueError("Prompt must not be blank")
        return self


@router.get("/models")
async def models(
    owner=Depends(get_owner_identity), provider=Depends(get_image_provider)
):
    settings = get_settings()
    name = settings.image_provider
    selected = getattr(settings, name + "_image_model", None)
    capabilities = MODELS.get(name, {}).get(selected)
    return {
        "provider": name,
        "available": provider.available and bool(capabilities),
        "models": [{"id": selected, **capabilities}] if capabilities else [],
        "max_n": settings.image_max_per_generation,
        "cost_warning": "Chargeable request. No reliable pre-generation estimate; provider pricing and policy apply. No automatic retries.",
    }


@router.get("/conversations/{conversation_id}")
async def history(
    conversation_id: UUID,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    await owned(session, conversation_id, owner)
    rows = (
        await session.scalars(
            select(ImageAsset)
            .where(
                ImageAsset.conversation_id == str(conversation_id),
                ImageAsset.owner == owner,
            )
            .order_by(ImageAsset.created_at, ImageAsset.id)
        )
    ).all()
    jobs = (
        await session.scalars(
            select(ImageJob)
            .where(
                ImageJob.conversation_id == str(conversation_id),
                ImageJob.owner == owner,
            )
            .order_by(ImageJob.created_at)
        )
    ).all()
    return {
        "assets": [asset_json(a) for a in rows],
        "jobs": [await job_json(session, j) for j in jobs],
    }


@router.get("/assets/{asset_id}")
async def retrieve(
    asset_id: UUID,
    download: bool = False,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    asset = await session.get(ImageAsset, str(asset_id))
    if not asset or asset.owner != owner:
        raise HTTPException(404, "Image not found")
    await owned(session, asset.conversation_id, owner)
    path = root() / asset.id
    if not path.is_file() or path.is_symlink():
        raise HTTPException(404, "Image unavailable")
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[asset.mime]
    return FileResponse(
        path,
        media_type=asset.mime,
        filename=f"{asset.id}.{ext}" if download else None,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.post("/jobs/{job_id}/cancel")
async def cancel(
    job_id: UUID,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    job = await session.get(ImageJob, str(job_id))
    if job:
        await guard_conversation(session, job.conversation_id, owner)
    changed = await session.execute(
        update(ImageJob)
        .where(
            ImageJob.id == str(job_id),
            ImageJob.owner == owner,
            ImageJob.status.in_(["running", "needs_recovery"]),
        )
        .values(status="cancelled")
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "Image job unavailable or no longer running")
    GovernancePolicy().record_audit(
        session,
        "image_generation_cancelled",
        actor="local-owner",
        target_type="image_job",
        metadata_={"job_id": str(job_id)},
    )
    return {"status": "cancelled"}


@router.post("/cleanup")
async def cleanup(
    owner=Depends(get_owner_identity), session: AsyncSession = Depends(get_db)
):
    # Shared SQLite writer lock excludes upload/result persistence while scanning.
    await session.execute(
        update(ImageJob).where(ImageJob.id == "").values(status=ImageJob.status)
    )
    known = set((await session.scalars(select(ImageAsset.id))).all())
    # Shared directory configuration must not turn valid uploads into image orphans.
    known.update((await session.scalars(select(ChatAttachment.id))).all())
    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(hours=get_settings().image_orphan_ttl_hours)
    ).timestamp()
    count = 0
    if root().is_dir():
        for path in root().iterdir():
            try:
                if (
                    str(UUID(path.name)) == path.name
                    and path.name not in known
                    and not path.is_symlink()
                    and path.is_file()
                    and path.stat().st_mtime < cutoff
                ):
                    path.unlink()
                    count += 1
            except (ValueError, OSError):
                continue
    return {"orphan_files_removed": count}


@router.post("/conversations/{conversation_id}/generate")
async def generate(
    conversation_id: UUID,
    payload: GenerateInput,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
    provider=Depends(get_image_provider),
):
    await guard_conversation(session, conversation_id, owner)
    settings = get_settings()
    changed = await session.execute(
        update(Conversation)
        .where(
            Conversation.id == str(conversation_id),
            Conversation.owner_identity == owner,
        )
        .values(updated_at=now())
    )
    if changed.rowcount != 1:
        raise HTTPException(404, "Conversation not found")
    # Recheck scope under the SQLite writer lock: deletion may race initial validation.
    await guard_conversation(session, conversation_id, owner)
    clean = redact_secrets(payload.prompt, settings)
    fingerprint = hashlib.sha256(
        json.dumps(
            {**payload.model_dump(mode="json"), "prompt": clean, **({"advanced": provider.request_fingerprint} if hasattr(provider,"request_fingerprint") else {})}, sort_keys=True
        ).encode()
    ).hexdigest()
    existing = await session.scalar(
        select(ImageJob).where(
            ImageJob.conversation_id == str(conversation_id),
            ImageJob.client_id == str(payload.client_message_id),
        )
    )
    if existing:
        if existing.fingerprint != fingerprint or existing.status != "completed":
            raise HTTPException(
                409,
                "Image request already attempted; inspect history before starting a new paid request",
            )
        return await job_json(session, existing)
    if await session.scalar(
        select(ConversationMessage.id).where(
            ConversationMessage.conversation_id == str(conversation_id),
            ConversationMessage.client_message_id == str(payload.client_message_id),
        )
    ):
        raise HTTPException(
            409, "Message ID already used by another conversation request"
        )
    if hasattr(provider, 'capabilities'):
        capability = provider.capabilities(payload.model)
        enabled_model = bool(capability)
    else:
        capability = MODELS.get(settings.image_provider, {}).get(payload.model)
        enabled_model = payload.model == getattr(settings, settings.image_provider + '_image_model', None)
    if not capability or not enabled_model:
        raise HTTPException(422, 'Unsupported image-generation model')
    if not provider.available:
        raise HTTPException(503, "Image provider unavailable or API key missing")
    if payload.n > min(settings.image_max_per_generation, capability["max_n"]):
        raise HTTPException(422, "Image count exceeds configured limit")
    if (payload.parent_id or payload.reference_attachment_id) and not capability[
        "reference"
    ]:
        raise HTTPException(422, "This model does not support reference images")
    active = await session.scalar(
        select(func.count())
        .select_from(ImageJob)
        .where(ImageJob.owner == owner, ImageJob.provider_active.is_(True))
    )
    busy = await session.scalar(
        select(ImageJob.id).where(
            ImageJob.conversation_id == str(conversation_id),
            ImageJob.provider_active.is_(True),
        )
    )
    chat = await session.scalar(
        select(ChatRequest.id).where(
            ChatRequest.conversation_id == str(conversation_id),
            ChatRequest.status == "running",
        )
    )
    work = await session.scalar(
        select(Task.id)
        .join(ConversationMessage, ConversationMessage.task_id == Task.id)
        .where(
            ConversationMessage.conversation_id == str(conversation_id),
            Task.status.in_(
                [TaskStatus.pending, TaskStatus.assigned, TaskStatus.in_progress]
            ),
        )
    )
    if active >= settings.image_max_concurrent or busy or chat or work:
        raise HTTPException(
            409,
            "Image/conversation concurrency limit reached; finish active work first",
        )
    parent = None
    reference = None
    if payload.parent_id:
        parent = await session.get(ImageAsset, str(payload.parent_id))
        if (
            not parent
            or parent.owner != owner
            or parent.conversation_id != str(conversation_id)
        ):
            raise HTTPException(404, "Reference image not found")
        path = root() / parent.id
        if (
            not path.is_file()
            or path.is_symlink()
            or path.stat().st_size > settings.image_max_output_bytes
        ):
            raise HTTPException(422, "Reference image unavailable or too large")
        reference = (path.read_bytes(), parent.mime)
    elif payload.reference_attachment_id:
        attachment = await session.get(
            ChatAttachment, str(payload.reference_attachment_id)
        )
        if (
            not attachment
            or attachment.owner != owner
            or attachment.conversation_id not in (None, str(conversation_id))
            or not attachment.kind.startswith("image/")
        ):
            raise HTTPException(404, "Uploaded reference image not found")
        path = Path(settings.chat_attachment_dir).resolve() / attachment.id
        if (
            not path.is_file()
            or path.is_symlink()
            or path.stat().st_size > settings.image_max_output_bytes
        ):
            raise HTTPException(422, "Reference unavailable or too large")
        reference = (path.read_bytes(), attachment.kind)
        attachment.conversation_id = str(
            conversation_id
        )  # Retain the original against attachment cleanup.
        parent = await session.scalar(
            select(ImageAsset).where(
                ImageAsset.source_attachment_id == attachment.id,
                ImageAsset.conversation_id == str(conversation_id),
            )
        )
        if not parent:
            parent = ImageAsset(
                id=str(uuid4()),
                owner=owner,
                conversation_id=str(conversation_id),
                source_attachment_id=attachment.id,
                mime=attachment.kind,
                created_at=now(),
            )
            session.add(parent)
            await session.flush()
            root().mkdir(parents=True, exist_ok=True)
            (root() / parent.id).write_bytes(reference[0])
    if reference:
        try:
            await parse_attachment(*reference)
        except Exception:
            raise HTTPException(422, "Invalid reference image") from None
    job = ImageJob(
        id=str(uuid4()),
        owner=owner,
        conversation_id=str(conversation_id),
        client_id=str(payload.client_message_id),
        fingerprint=fingerprint,
        status="running",
        model=payload.model,
        created_at=now(),
    )
    session.add(job)
    session.add(
        ConversationMessage(
            conversation_id=str(conversation_id),
            role="user",
            content=clean,
            created_at=now(),
            client_message_id=str(payload.client_message_id),
        )
    )
    GovernancePolicy().record_audit(
        session,
        "image_generation_started",
        actor="local-owner",
        target_type="image_job",
        metadata_={"job_id": job.id},
    )
    await session.commit()
    error = None
    result = None
    pending_remote = False
    try:
        result = await asyncio.wait_for(
            provider.generate(
                clean,
                payload.model,
                payload.quality,
                payload.aspect_ratio,
                payload.n,
                reference,
            ),
            getattr(provider, "timeout_seconds", settings.image_timeout_seconds),
        )
        if (
            not result.images
            or len(result.images) > payload.n
            or sum(len(b) for b, m in result.images) > settings.image_max_output_bytes
        ):
            raise ValueError("Output limit")
        for content, mime in result.images:
            if mime not in ("image/png", "image/jpeg", "image/webp"):
                raise ValueError("Invalid generated image type")
            await parse_attachment(content, mime)
    except ImageExecutionPending:
        pending_remote = True
        error = 'Remote execution uncertain; use read-only recovery, never automatically resubmit'
    except ImageProviderError as exc:
        # Only adapter-controlled messages, never an arbitrary upstream message.
        error = (
            "Image request refused or unsupported by provider"
            if "refused" in str(exc)
            else "Image provider request failed; no automatic retry"
        )
    except (Exception, asyncio.CancelledError):
        error = "Image request failed or timed out; no automatic retry"
    # Conditional write takes the writer lock; cancellation wins over any late result/error.
    changed = await session.execute(
        update(ImageJob)
        .where(ImageJob.id == job.id, ImageJob.status == "running")
        .values(status="needs_recovery" if pending_remote else "failed" if error else "completed", error=error)
    )
    if changed.rowcount:
        if not error:
            message = ConversationMessage(
                conversation_id=str(conversation_id),
                role="assistant",
                content="Image Studio result",
                created_at=now(),
            )
            session.add(message)
            await session.flush()
            root().mkdir(parents=True, exist_ok=True)
            for content, mime in result.images:
                asset = ImageAsset(
                    id=str(uuid4()),
                    owner=owner,
                    conversation_id=str(conversation_id),
                    parent_id=parent.id if parent else None,
                    job_id=job.id,
                    message_id=message.id,
                    mime=mime,
                    created_at=now(),
                )
                session.add(asset)
                await session.flush()
                (root() / asset.id).write_bytes(content)

        GovernancePolicy().record_audit(
            session,
            "image_generation_uncertain" if pending_remote else "image_generation_failed" if error else "image_generation_completed",
            actor="local-owner",
            target_type="image_job",
            metadata_={"job_id": job.id},
        )
        await session.execute(
            update(Conversation)
            .where(Conversation.id == str(conversation_id))
            .values(updated_at=now())
        )
    else:
        GovernancePolicy().record_audit(
            session,
            "image_generation_discarded",
            actor="local-owner",
            target_type="image_job",
            metadata_={"job_id": job.id},
        )
    await session.execute(
        update(ImageJob)
        .where(ImageJob.id == job.id, ImageJob.provider_active.is_(True))
        .values(
            provider_active=pending_remote,
            **(
                {"usage": json.dumps(safe_usage(result.usage))}
                if result is not None
                else {}
            ),
        )
    )
    await session.commit()
    await session.refresh(job)
    return await job_json(session, job)
