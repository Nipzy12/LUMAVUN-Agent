"""Advanced Studio: fixed recipes, reviewed models and immutable image services."""

import asyncio
from io import BytesIO
import hashlib
import json
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.auth import get_owner_identity
from luma_core.config import get_settings
from luma_core.db.session import get_db
from luma_core.models import (
    ImageAsset,
    ImageJob,
    ConversationMessage,
    ChatAttachment,
    StudioExecution,
    LoraPreset,
    StudioPreference,
)
from luma_core.memory.attachments import parse_attachment
from luma_core.memory.conversations import now
from luma_core.memory.studio_privacy import (
    guard_conversation,
    guard_attachment,
    private_owner,
)
from luma_core.providers.comfyui import ComfyUI, LoraSelection, workflow, ComfyRejected
from luma_core.providers.images import (
    ImageExecutionPending,
    ImageProviderError,
    ImageProvider,
)
from luma_core.providers.prompts import redact_secrets
from luma_core.routers import images

router = APIRouter(prefix="/api/studio", tags=["advanced-studio"])


class StudioInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_message_id: UUID
    engine: Literal["cloud", "comfy_local", "comfy_remote"] = "comfy_local"
    operation: Literal["text_to_image", "image_to_image", "inpaint"] = "text_to_image"
    model: str = Field(min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=2000)
    width: int = Field(default=512, ge=64, le=2048, multiple_of=8)
    height: int = Field(default=512, ge=64, le=2048, multiple_of=8)
    seed: int | None = Field(default=None, ge=0, le=2**63 - 1)
    steps: int = Field(default=20, ge=1, le=100)
    cfg: float = Field(default=7, ge=1, le=12, allow_inf_nan=False)
    denoise: float = Field(default=0.65, ge=0.01, le=1, allow_inf_nan=False)
    n: int = Field(default=1, ge=1, le=4)
    loras: list[LoraSelection] = Field(default_factory=list, max_length=3)
    parent_id: UUID | None = None
    reference_attachment_id: UUID | None = None
    mask_attachment_id: UUID | None = None
    quality: Literal["low", "medium", "high"] = "medium"
    aspect_ratio: Literal["1:1", "16:9", "9:16"] = "1:1"
    confirm_cloud: bool = False

    @model_validator(mode="after")
    def compatible(self):
        if not self.prompt.strip():
            raise ValueError("Blank prompt")
        if self.parent_id and self.reference_attachment_id:
            raise ValueError("Choose one reference")
        has_reference = bool(self.parent_id or self.reference_attachment_id)
        if (self.operation == "text_to_image") == has_reference:
            raise ValueError("Operation/reference mismatch")
        if (self.operation == "inpaint") != bool(self.mask_attachment_id):
            raise ValueError("Mask required only for inpainting")
        if has_reference and self.n != 1:
            raise ValueError("Edits support one result")
        if len({selection.id for selection in self.loras}) != len(self.loras):
            raise ValueError("Duplicate LoRA")
        return self


async def catalog_data(engine, owner, session=None):
    if engine == "cloud":
        settings = get_settings()
        provider = ImageProvider(settings)
        data = await images.models(owner, provider)
        enabled = data["available"] and (
            private_owner.get() != owner or settings.private_studio_allow_cloud
        )
        return {
            "available": enabled,
            "engine": engine,
            "models": [
                {
                    "id": r["id"],
                    "display_name": r["id"],
                    "ready": enabled,
                    "family": "cloud",
                    "available": enabled,
                    "compatible": True,
                    "inpaint": False,
                    "version": "provider-managed",
                    "license": "Provider policies",
                    "source": "Configured cloud provider",
                    "requirements": "No local GPU",
                    "verification": "server allowlist",
                }
                for r in data["models"]
            ],
            "loras": [],
            "reason": None
            if enabled
            else "Cloud provider unavailable or private transfer disabled",
        }
    try:
        backend = ComfyUI(get_settings(), engine)
        data = await backend.catalog()
        for row in data["models"] + data["loras"]:
            for key, value in list(row.items()):
                if isinstance(value, str):
                    row[key] = redact_secrets(value, get_settings())
                elif isinstance(value, list):
                    row[key] = [
                        redact_secrets(item, get_settings())
                        if isinstance(item, str)
                        else item
                        for item in value
                    ]

        def visible(row):
            return not row.get("private_only") or private_owner.get() == owner

        if private_owner.get() == owner:
            for row in data["models"] + data["loras"]:
                if not row.get("adult_content_permitted"):
                    row["ready"] = False
                    row["reason"] = (
                        "License/policy not approved for private adult artwork"
                    )
        preference = (
            await session.get(StudioPreference, (owner, private_owner.get() == owner))
            if session
            else None
        )
        default_model = (
            preference.default_model
            if preference and preference.engine == engine
            else get_settings().comfyui_default_model
        )
        if not any(
            row["id"] == default_model and visible(row) for row in data["models"]
        ):
            default_model = None
        return {
            "available": True,
            "engine": engine,
            "default_model": default_model,
            "models": [r for r in data["models"] if visible(r)],
            "loras": [r for r in data["loras"] if visible(r)],
        }
    except Exception:
        return {
            "available": False,
            "engine": engine,
            "models": [],
            "loras": [],
            "reason": "ComfyUI disabled, unreachable, untrusted or model manifest invalid",
        }


@router.get("/catalog")
async def catalog(
    engine: Literal["cloud", "comfy_local", "comfy_remote"] = "comfy_local",
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    return await catalog_data(engine, owner, session)


class DefaultModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    engine: Literal["cloud", "comfy_local", "comfy_remote"]
    model: str = Field(min_length=1, max_length=128)


@router.put("/default-model")
async def set_default(
    payload: DefaultModel,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    data = await catalog_data(payload.engine, owner, session)
    if not any(r["id"] == payload.model and r["ready"] for r in data["models"]):
        raise HTTPException(422, "Default model unavailable")
    row = await session.get(StudioPreference, (owner, private_owner.get() == owner))
    if not row:
        row = StudioPreference(owner=owner, private=private_owner.get() == owner)
        session.add(row)
    row.engine = payload.engine
    row.default_model = payload.model
    await session.flush()
    return {"default_model": row.default_model}


class PresetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    family: Literal["sd15", "sdxl"]
    selections: list[LoraSelection] = Field(min_length=1, max_length=3)
    engine: Literal["comfy_local", "comfy_remote"] = "comfy_local"


@router.get("/presets")
async def presets(
    owner=Depends(get_owner_identity), session: AsyncSession = Depends(get_db)
):
    rows = (
        await session.scalars(
            select(LoraPreset).where(
                LoraPreset.owner == owner,
                LoraPreset.private == (private_owner.get() == owner),
            )
        )
    ).all()
    return {
        "items": [
            {
                "id": r.id,
                "name": r.name,
                "family": r.family,
                "selections": json.loads(r.selections),
            }
            for r in rows
        ]
    }


@router.post("/presets", status_code=201)
async def save_preset(
    payload: PresetInput,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    data = await catalog_data(payload.engine, owner, session)
    if not data["available"]:
        raise HTTPException(503, "LoRA catalog unavailable")
    if len({r.id for r in payload.selections}) != len(payload.selections) or any(
        not any(
            r["id"] == choice.id and r["family"] == payload.family and r["ready"]
            for r in data["loras"]
        )
        for choice in payload.selections
    ):
        raise HTTPException(422, "Preset contains incompatible or unavailable LoRAs")
    row = LoraPreset(
        id=str(uuid4()),
        owner=owner,
        name=redact_secrets(payload.name, get_settings()),
        family=payload.family,
        private=private_owner.get() == owner,
        selections=json.dumps(
            [selection.model_dump() for selection in payload.selections]
        ),
    )
    session.add(row)
    await session.flush()
    return {"id": row.id}


async def reference_bytes(session, payload, conversation_id, owner):
    if payload.parent_id:
        asset = await session.get(ImageAsset, str(payload.parent_id))
        if (
            not asset
            or asset.owner != owner
            or asset.conversation_id != str(conversation_id)
        ):
            raise HTTPException(404, "Reference not found")
        path = images.root() / asset.id
        mime = asset.mime
    elif payload.reference_attachment_id:
        await guard_attachment(session, payload.reference_attachment_id, owner)
        attachment = await session.get(
            ChatAttachment, str(payload.reference_attachment_id)
        )
        if (
            not attachment
            or attachment.owner != owner
            or attachment.conversation_id not in (None, str(conversation_id))
            or not attachment.kind.startswith("image/")
        ):
            raise HTTPException(404, "Reference not found")
        from pathlib import Path

        path = Path(get_settings().chat_attachment_dir).resolve() / attachment.id
        mime = attachment.kind
    else:
        return None
    if (
        not path.is_file()
        or path.is_symlink()
        or path.stat().st_size > get_settings().image_max_output_bytes
    ):
        raise HTTPException(422, "Reference unavailable")
    return path.read_bytes(), mime


class NativeProvider:
    available = True

    def __init__(
        self,
        backend,
        payload,
        data,
        record,
        loras,
        session,
        owner,
        conversation_id,
        mask,
    ):
        self.backend = backend
        self.payload = payload
        self.data = data
        self.record = record
        self.loras = loras
        self.session = session
        self.owner = owner
        self.conversation_id = str(conversation_id)
        self.mask = mask
        self.timeout_seconds = get_settings().comfyui_timeout_seconds + 10
        self.request_fingerprint = hashlib.sha256(
            json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()

    def capabilities(self, model):
        return (
            {"reference": True, "max_n": get_settings().image_max_per_generation}
            if model == self.payload.model
            else None
        )

    async def generate(self, prompt, model, quality, ratio, n, reference=None):
        session = self.session
        job = await session.scalar(
            select(ImageJob).where(
                ImageJob.conversation_id == self.conversation_id,
                ImageJob.client_id == str(self.payload.client_message_id),
            )
        )
        parent = self.payload.parent_id
        if self.payload.reference_attachment_id:
            asset = await session.scalar(
                select(ImageAsset).where(
                    ImageAsset.conversation_id == self.conversation_id,
                    ImageAsset.source_attachment_id
                    == str(self.payload.reference_attachment_id),
                )
            )
            parent = asset.id if asset else None
        execution = StudioExecution(
            job_id=job.id,
            engine=self.payload.engine,
            stage="prepared",
            recipe=self.payload.operation + ":v1",
            mask_id=str(self.payload.mask_attachment_id)
            if self.payload.mask_attachment_id
            else None,
            parameters=json.dumps(
                {
                    "parent_id": str(parent) if parent else None,
                    "endpoint_hash": hashlib.sha256(
                        self.backend.url.encode()
                    ).hexdigest(),
                    "seed": self.payload.seed,
                    "n": n,
                }
            ),
        )
        session.add(execution)
        await session.commit()
        accepted = False
        watcher = None
        try:
            source = await self.backend.upload(*reference) if reference else None
            mask = (
                await self.backend.upload(self.mask, "image/png") if self.mask else None
            )
            graph = workflow(
                self.payload, self.record, self.loras, source, mask, job.id
            )
            # Validate exact recipe nodes against the actual server before any submission.
            if any(
                node["class_type"] not in self.data["nodes"] for node in graph.values()
            ):
                raise ImageProviderError("Required workflow nodes unavailable")
            await session.refresh(job)
            if job.status != "running":
                execution.stage = "finished"
                await session.commit()
                raise ImageProviderError("Execution cancelled before submission")
            execution.stage = "submitting"
            await session.commit()
            accepted = True
            execution.remote_id = await self.backend.submit(graph, job.id)
            execution.stage = "running"
            await session.commit()
            progress = asyncio.Queue(maxsize=1)
            if get_settings().comfyui_ws_progress:
                watcher = asyncio.create_task(
                    self.backend.websocket_progress(
                        job.id, execution.remote_id, progress
                    )
                )
            deadline = (
                asyncio.get_running_loop().time()
                + get_settings().comfyui_timeout_seconds
            )
            interrupted = False
            while asyncio.get_running_loop().time() < deadline:
                await session.refresh(job)
                if job.status == "cancelled" and not interrupted:
                    await self.backend.interrupt(execution.remote_id)
                    interrupted = True
                history = await self.backend.history(execution.remote_id)
                if history and history.get("status", {}).get("completed"):
                    execution.stage = "finished"
                    execution.progress = 100
                    await session.commit()
                    if job.status == "cancelled":
                        raise ImageProviderError("Cancelled remote execution ended")
                    return await self.backend.outputs(history, model)
                if history and history.get("status", {}).get("status_str") == "error":
                    execution.stage = "finished"
                    await session.commit()
                    raise ImageProviderError("ComfyUI execution failed")
                if (
                    job.status == "cancelled"
                    and not history
                    and not await self.backend.active(execution.remote_id)
                ):
                    execution.stage = "finished"
                    await session.commit()
                    raise ImageProviderError("Cancelled remote job left the queue")
                if not progress.empty():
                    execution.progress = progress.get_nowait()
                    await session.commit()
                await asyncio.sleep(0.4)
            raise ImageExecutionPending()
        except (Exception, asyncio.CancelledError) as exc:
            await session.refresh(job)
            if not job.provider_active:
                execution.stage = "finished"
                await session.commit()
                raise ImageProviderError("Execution already finalized") from None
            if isinstance(exc, ComfyRejected):
                execution.stage = "finished"
                await session.commit()
                accepted = False
            if accepted and execution.stage != "finished":
                execution.stage = "needs_recovery"
                await session.commit()
                raise ImageExecutionPending() from None
            raise ImageProviderError("ComfyUI execution failed") from None
        finally:
            if watcher:
                watcher.cancel()
                await asyncio.gather(watcher, return_exceptions=True)


@router.post("/conversations/{conversation_id}/generate")
async def generate(
    conversation_id: UUID,
    payload: StudioInput,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    from luma_core.routers.conversations import owned

    await owned(session, conversation_id, owner)
    settings = get_settings()
    payload = payload.model_copy(deep=True)
    payload.prompt = redact_secrets(payload.prompt, settings)
    payload.negative_prompt = redact_secrets(payload.negative_prompt, settings)
    if (
        private_owner.get() == owner
        and payload.engine == "cloud"
        and not (settings.private_studio_allow_cloud and payload.confirm_cloud)
    ):
        raise HTTPException(
            403,
            "Private cloud transfer requires server permission and explicit confirmation; provider policies still apply",
        )
    common = images.GenerateInput(
        client_message_id=payload.client_message_id,
        prompt=payload.prompt,
        model=payload.model,
        quality=payload.quality,
        aspect_ratio=payload.aspect_ratio,
        n=payload.n,
        parent_id=payload.parent_id,
        reference_attachment_id=payload.reference_attachment_id,
    )
    if payload.engine == "cloud":
        if (
            payload.operation == "inpaint"
            or payload.negative_prompt
            or payload.loras
            or any(
                k in payload.model_fields_set
                for k in ("width", "height", "steps", "cfg", "seed", "denoise")
            )
        ):
            raise HTTPException(
                422, "Selected cloud adapter does not support these workflow controls"
            )
        return await images.generate(
            conversation_id, common, owner, session, ImageProvider(settings)
        )
    if any(k in payload.model_fields_set for k in ("quality", "aspect_ratio")):
        raise HTTPException(
            422,
            "Native recipes use dimensions/steps, not cloud quality/aspect parameters",
        )
    if (
        payload.width * payload.height > settings.studio_max_pixels
        or payload.steps > settings.studio_max_steps
    ):
        raise HTTPException(422, "Workflow exceeds configured resource limits")
    try:
        backend = ComfyUI(settings, payload.engine)
        data = await backend.catalog()
    except Exception:
        raise HTTPException(
            503, "ComfyUI unavailable or model catalog invalid"
        ) from None
    record = data["internal"].get(("models", payload.model))
    if (
        not record
        or not record["ready"]
        or (record.get("private_only") and private_owner.get() != owner)
    ):
        raise HTTPException(422, "Model unavailable, incompatible or unverified")
    if (
        private_owner.get() == owner
        and record.get("adult_content_permitted") is not True
    ):
        raise HTTPException(
            422, "Model license/policy has not been approved for this private workspace"
        )
    if payload.operation == "inpaint" and record.get("inpaint") is not True:
        raise HTTPException(422, "Checkpoint is not approved for inpainting")
    required_nodes = {
        "CheckpointLoaderSimple",
        "CLIPTextEncode",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    }
    required_nodes |= (
        {"EmptyLatentImage"}
        if payload.operation == "text_to_image"
        else {"LoadImage", "ImageScale", "VAEEncode"}
        if payload.operation == "image_to_image"
        else {"LoadImage", "ImageScale", "ImageToMask", "InpaintModelConditioning"}
    )
    if payload.loras:
        required_nodes.add("LoraLoader")
    if not required_nodes <= data["nodes"]:
        raise HTTPException(
            422, "Required trusted workflow nodes unavailable; no inputs uploaded"
        )
    loras = []
    for selection in payload.loras:
        entry = data["internal"].get(("loras", selection.id))
        if (
            not entry
            or not entry["ready"]
            or entry["family"] != record["family"]
            or (
                entry.get("compatible_models")
                and payload.model not in entry["compatible_models"]
            )
            or (entry.get("private_only") and private_owner.get() != owner)
        ):
            raise HTTPException(422, "LoRA incompatible, unavailable or unverified")
        if (
            private_owner.get() == owner
            and entry.get("adult_content_permitted") is not True
        ):
            raise HTTPException(
                422, "LoRA license/policy not approved for private artwork"
            )
        loras.append((entry, selection.strength))
    mask = None
    if payload.mask_attachment_id:
        await guard_attachment(session, payload.mask_attachment_id, owner)
        row = await session.get(ChatAttachment, str(payload.mask_attachment_id))
        if (
            not row
            or row.owner != owner
            or row.kind != "image/png"
            or row.conversation_id not in (None, str(conversation_id))
        ):
            raise HTTPException(404, "Mask not found")
        from pathlib import Path

        path = Path(settings.chat_attachment_dir).resolve() / row.id
        if (
            not path.is_file()
            or path.is_symlink()
            or path.stat().st_size > settings.image_max_output_bytes
        ):
            raise HTTPException(422, "Mask unavailable")
        mask = path.read_bytes()
        reference = await reference_bytes(session, payload, conversation_id, owner)
        try:
            await parse_attachment(mask, "image/png")
            from PIL import Image

            with (
                Image.open(BytesIO(mask)) as image,
                Image.open(BytesIO(reference[0])) as source,
            ):
                if (
                    image.size != source.size
                    or image.width * image.height > settings.studio_max_pixels
                ):
                    raise ValueError()
        except Exception:
            raise HTTPException(
                422, "Mask must be a valid PNG matching reference dimensions"
            ) from None
        row.conversation_id = str(conversation_id)
        await session.flush()
    if payload.seed is None:
        payload.seed = payload.client_message_id.int % (2**32)
    provider = NativeProvider(
        backend, payload, data, record, loras, session, owner, conversation_id, mask
    )
    return await images.generate(conversation_id, common, owner, session, provider)


@router.get("/jobs/{job_id}")
async def job_status(
    job_id: UUID,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    job = await session.get(ImageJob, str(job_id))
    if not job or job.owner != owner:
        raise HTTPException(404, "Job not found")
    await guard_conversation(session, job.conversation_id, owner)
    execution = await session.get(StudioExecution, job.id)
    return {
        **await images.job_json(session, job),
        "execution": {
            "stage": execution.stage,
            "remote_id": execution.remote_id,
            "progress": execution.progress,
            "engine": execution.engine,
        }
        if execution
        else None,
    }


@router.post("/jobs/{job_id}/recover")
async def recover(
    job_id: UUID,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    job = await session.get(ImageJob, str(job_id))
    execution = await session.get(StudioExecution, str(job_id))
    if not job or job.owner != owner or not execution:
        raise HTTPException(404, "Remote job not found")
    await guard_conversation(session, job.conversation_id, owner)
    if not job.provider_active:
        return await images.job_json(session, job)
    if not execution.remote_id:
        raise HTTPException(
            409,
            "Remote acceptance unknown; operator inspection required, never automatically resubmit",
        )
    try:
        backend = ComfyUI(get_settings(), execution.engine)
        metadata = json.loads(execution.parameters)
        if (
            metadata.get("endpoint_hash")
            != hashlib.sha256(backend.url.encode()).hexdigest()
        ):
            raise ValueError()
        history = await backend.history(execution.remote_id)
        if (
            not history
            and job.status == "cancelled"
            and not await backend.active(execution.remote_id)
        ):
            changed = await session.execute(
                update(ImageJob)
                .where(
                    ImageJob.id == job.id,
                    ImageJob.status == "cancelled",
                    ImageJob.provider_active.is_(True),
                )
                .values(provider_active=False)
            )
            execution.stage = "finished"
            from luma_core.governance.policy import GovernancePolicy

            if changed.rowcount:
                GovernancePolicy().record_audit(
                    session,
                    "image_generation_recovered_cancelled",
                    actor="local-owner",
                    target_type="image_job",
                    metadata_={"job_id": job.id},
                )
            await session.commit()
            await session.refresh(job)
            return await images.job_json(session, job)
        if not history or not (
            history.get("status", {}).get("completed")
            or history.get("status", {}).get("status_str") == "error"
        ):
            return {**await images.job_json(session, job), "recovery": "waiting"}
        failed = history.get("status", {}).get("status_str") == "error"
        result = (
            None
            if failed or job.status == "cancelled"
            else await backend.outputs(history, job.model)
        )
        if result:
            for content, mime in result.images:
                await parse_attachment(content, mime)
    except Exception:
        raise HTTPException(
            503, "Remote recovery unavailable; no resubmission attempted"
        ) from None
    changed = await session.execute(
        update(ImageJob)
        .where(
            ImageJob.id == job.id,
            ImageJob.provider_active.is_(True),
            ImageJob.status.in_(["running", "needs_recovery"]),
        )
        .values(
            status="failed" if failed else "completed",
            provider_active=False,
            error="Remote execution failed" if failed else None,
        )
    )
    if changed.rowcount and result:
        message = ConversationMessage(
            conversation_id=job.conversation_id,
            role="assistant",
            content="Recovered Image Studio result",
            created_at=now(),
        )
        session.add(message)
        await session.flush()
        images.root().mkdir(parents=True, exist_ok=True)
        for content, mime in result.images:
            asset = ImageAsset(
                id=str(uuid4()),
                owner=owner,
                conversation_id=job.conversation_id,
                parent_id=metadata.get("parent_id"),
                job_id=job.id,
                message_id=message.id,
                mime=mime,
                created_at=now(),
            )
            session.add(asset)
            await session.flush()
            (images.root() / asset.id).write_bytes(content)
    await session.execute(
        update(ImageJob)
        .where(ImageJob.id == job.id, ImageJob.status == "cancelled")
        .values(provider_active=False)
    )
    execution.stage = "finished"
    execution.progress = 100
    from luma_core.governance.policy import GovernancePolicy

    if changed.rowcount:
        GovernancePolicy().record_audit(
            session,
            "image_generation_recovered",
            actor="local-owner",
            target_type="image_job",
            metadata_={"job_id": job.id},
        )
    await session.commit()
    await session.refresh(job)
    return await images.job_json(session, job)


@router.post("/jobs/{job_id}/cancel")
async def cancel(
    job_id: UUID,
    owner=Depends(get_owner_identity),
    session: AsyncSession = Depends(get_db),
):
    result = await images.cancel(job_id, owner, session)
    await session.commit()
    execution = await session.get(StudioExecution, str(job_id))
    if execution and execution.remote_id and execution.stage == "needs_recovery":
        try:
            backend = ComfyUI(get_settings(), execution.engine)
            if (
                json.loads(execution.parameters).get("endpoint_hash")
                == hashlib.sha256(backend.url.encode()).hexdigest()
            ):
                result["remote_interrupt_requested"] = await backend.interrupt(
                    execution.remote_id
                )
        except Exception:
            result["remote_interrupt_requested"] = False
    return result
