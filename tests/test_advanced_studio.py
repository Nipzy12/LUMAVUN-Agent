"""Mocked ComfyUI and private isolation tests. Never load models or call paid APIs."""

import asyncio
from io import BytesIO
import hashlib
import json
from pathlib import Path
import re
from unittest.mock import patch
from uuid import uuid4

import httpx
from PIL import Image
import pytest

from luma_core.config import Settings
from luma_core.models import (
    StudioExecution,
    StudioUnlock,
    ImageJob,
    ImageAsset,
)
from luma_core.providers.comfyui import ComfyUI, NODES, endpoint
from luma_core.providers.images import ImageProviderError
from luma_core.routers import studio, images, private_studio, chat
from tests import test_executor_review as executor_review_tests

file_client = executor_review_tests.file_client


def picture(size=(32, 32)):
    output = BytesIO()
    Image.new("RGB", size, "#7e9680").save(output, format="PNG")
    return output.getvalue()


class FakeComfy:
    def __init__(self):
        self.requests = []
        self.graphs = []
        self.pending = False
        self.fail_submit = False
        self.remote_id = str(uuid4())
        self.fail_output = False

    def handle(self, request):
        self.requests.append(request)
        path = request.url.path
        assert request.url.host == "127.0.0.1", "No real paid or external calls allowed"
        if path == "/system_stats":
            return httpx.Response(200, json={"system": {}})
        if path == "/object_info":
            data = {node: {"input": {"required": {}}} for node in NODES}
            data["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"] = [
                [
                    "base.safetensors",
                    "xl.safetensors",
                    "mask.safetensors",
                    "secret.safetensors",
                    "unknown.ckpt",
                ]
            ]
            data["LoraLoader"]["input"]["required"]["lora_name"] = [
                ["style.safetensors", "xlstyle.safetensors"]
            ]
            return httpx.Response(200, json=data)
        if path == "/upload/image":
            name = re.search(rb'filename="([^"]+)"', request.content).group(1).decode()
            return httpx.Response(
                200, json={"name": name, "subfolder": "luma", "type": "input"}
            )
        if path == "/prompt":
            if self.fail_submit:
                raise httpx.ReadTimeout("secret upstream failure")
            data = json.loads(request.content)
            self.graphs.append(data["prompt"])
            assert all(n["class_type"] in NODES for n in data["prompt"].values())
            return httpx.Response(200, json={"prompt_id": self.remote_id})
        if path.startswith("/history/"):
            return httpx.Response(
                200,
                json={}
                if self.pending
                else {
                    self.remote_id: {
                        "status": {"completed": True, "status_str": "success"},
                        "outputs": {
                            "save": {
                                "images": [
                                    {
                                        "filename": "luma_result.png",
                                        "subfolder": "",
                                        "type": "output",
                                    }
                                ]
                            }
                        },
                    }
                },
            )
        if path == "/queue":
            return httpx.Response(
                200,
                json={
                    "queue_running": [[0, self.remote_id]] if self.pending else [],
                    "queue_pending": [],
                },
            )
        if path == "/view":
            return httpx.Response(
                200, content=b"bad" if self.fail_output else picture()
            )
        if path.startswith("/api/jobs/") and path.endswith("/cancel"):
            return httpx.Response(200, json={"cancelled": True})
        raise AssertionError("Unexpected backend path")


@pytest.fixture
def advanced(tmp_path):
    manifest = {"models": [], "loras": []}
    for identifier, family, inpaint, secret in [
        ("base", "sd15", False, False),
        ("xl", "sdxl", False, False),
        ("mask", "sd15", True, False),
        ("secret", "sd15", False, True),
    ]:
        manifest["models"].append(
            {
                "id": identifier,
                "file": identifier + ".safetensors",
                "family": family,
                "display_name": identifier,
                "version": "1",
                "sha256": "a" * 64,
                "verified_by_operator": True,
                "license": "Test license",
                "source": "Operator fixture",
                "inpaint": inpaint,
                "private_only": secret,
                "adult_content_permitted": True,
            }
        )
    for identifier, family in [("style", "sd15"), ("xlstyle", "sdxl")]:
        manifest["loras"].append(
            {
                "id": identifier,
                "file": identifier + ".safetensors",
                "family": family,
                "sha256": "a" * 64,
                "verified_by_operator": True,
                "license": "Test license",
                "source": "Operator fixture",
                "adult_content_permitted": True,
            }
        )
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest))
    settings = Settings(
        _env_file=None,
        local_owner_token="test-owner-token-12345",
        comfyui_enabled=True,
        private_studio_enabled=True,
        comfyui_manifest=str(path),
        image_storage_dir=str(tmp_path / "images"),
        chat_attachment_dir=str(tmp_path / "uploads"),
        comfyui_timeout_seconds=30,
    )
    fake = FakeComfy()
    original = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(fake.handle))
        return original(*args, **kwargs)

    with (
        patch.object(studio, "get_settings", return_value=settings),
        patch.object(images, "get_settings", return_value=settings),
        patch.object(private_studio, "get_settings", return_value=settings),
        patch.object(chat, "get_settings", return_value=settings),
        patch("httpx.AsyncClient", side_effect=client_factory),
    ):
        yield fake, settings, manifest, path


async def conversation(client):
    return (await client.post("/api/conversations", json={})).json()["id"]


async def run(client, cid, **kwargs):
    return await client.post(
        "/api/studio/conversations/" + cid + "/generate",
        json={
            "client_message_id": str(uuid4()),
            "model": "base",
            "prompt": "A fictional adult explorer in a landscape",
            **kwargs,
        },
    )


async def private_session(client):
    result = await client.post(
        "/api/private-studio/unlock",
        json={
            "adult_eligible": True,
            "fictional_adults_only": True,
            "accept_law_license_provider_policies": True,
        },
    )
    assert result.status_code == 200, result.text
    client.headers["X-Luma-Studio-Session"] = result.json()["session_token"]
    return result.json()["session_token"]


@pytest.mark.asyncio
async def test_catalog_disabled_discovery_and_default(client, advanced):
    fake, settings, _, _ = advanced
    settings.comfyui_enabled = False
    assert not (await client.get("/api/studio/catalog")).json()["available"]
    assert not fake.requests
    settings.comfyui_enabled = True
    data = (await client.get("/api/studio/catalog")).json()
    assert data["available"] and any(m["family"] == "sdxl" for m in data["models"])
    assert not any(m["id"] == "secret" for m in data["models"])
    assert any(not m["ready"] for m in data["models"])
    assert (
        await client.put(
            "/api/studio/default-model", json={"engine": "comfy_local", "model": "base"}
        )
    ).status_code == 200
    assert (await client.get("/api/studio/catalog")).json()["default_model"] == "base"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [
        {"model": "../unsafe.ckpt"},
        {"model": "unknown"},
        {"steps": 41},
        {"width": 2048, "height": 2048},
        {"loras": [{"id": "xlstyle", "strength": 1}]},
        {"loras": [{"id": "style", "strength": 2}]},
        {"workflow": {"class_type": "ExecutePython"}},
    ],
)
async def test_invalid_requests_never_submit(client, advanced, override):
    result = await run(client, await conversation(client), **override)
    assert result.status_code == 422, result.text
    assert not advanced[0].graphs


@pytest.mark.asyncio
async def test_generation_loras_preset_and_idempotency(client, advanced):
    fake, _, _, _ = advanced
    cid = await conversation(client)
    key = str(uuid4())
    result = await run(
        client,
        cid,
        client_message_id=key,
        negative_prompt="blur",
        loras=[{"id": "style", "strength": 0.7}],
        seed=42,
    )
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "completed", result.text
    graph = fake.graphs[0]
    assert (
        graph["negative"]["inputs"]["text"] == "blur"
        and graph["sample"]["inputs"]["seed"] == 42
    )
    assert graph["lora0"]["inputs"]["strength_model"] == 0.7
    assert (
        await run(
            client,
            cid,
            client_message_id=key,
            negative_prompt="blur",
            loras=[{"id": "style", "strength": 0.7}],
            seed=42,
        )
    ).json()["status"] == "completed"
    assert len(fake.graphs) == 1
    assert (await run(client, cid, client_message_id=key, steps=15)).status_code == 409
    assert (
        await client.post(
            "/api/studio/presets",
            json={
                "name": "My style",
                "family": "sd15",
                "selections": [{"id": "style", "strength": 0.7}],
            },
        )
    ).status_code == 201
    assert len((await client.get("/api/studio/presets")).json()["items"]) == 1
    assert (
        await client.post(
            "/api/studio/presets",
            json={
                "name": "Wrong family",
                "family": "sdxl",
                "selections": [{"id": "style"}],
            },
        )
    ).status_code == 422
    job_id = result.json()["id"]
    state = (await client.get("/api/studio/jobs/" + job_id)).json()
    assert (
        state["execution"]["remote_id"] == fake.remote_id
        and state["execution"]["progress"] == 100
    )
    assert (await client.get("/api/tasks")).json()["items"] == []


@pytest.mark.asyncio
async def test_image_to_image_inpaint_mask_validation_and_parent(client, advanced):
    cid = await conversation(client)
    first = (await run(client, cid)).json()["assets"][0]
    uploaded = await client.post(
        "/api/chat/attachments",
        content=picture(),
        headers={"Content-Type": "image/png"},
    )
    mask = uploaded.json()["id"]
    result = await run(
        client,
        cid,
        model="mask",
        operation="inpaint",
        parent_id=first["id"],
        mask_attachment_id=mask,
    )
    assert result.status_code == 200 and result.json()["status"] == "completed", (
        result.text
    )
    assert result.json()["assets"][0]["parent_id"] == first["id"]
    assert advanced[0].graphs[-1]["latent"]["class_type"] == "InpaintModelConditioning"
    wrong = (
        await client.post(
            "/api/chat/attachments",
            content=picture((16, 16)),
            headers={"Content-Type": "image/png"},
        )
    ).json()["id"]
    assert (
        await run(
            client,
            cid,
            model="mask",
            operation="inpaint",
            parent_id=first["id"],
            mask_attachment_id=wrong,
        )
    ).status_code == 422
    assert (
        await run(
            client,
            cid,
            operation="inpaint",
            parent_id=first["id"],
            mask_attachment_id=mask,
        )
    ).status_code == 422
    second = await run(
        client, cid, operation="image_to_image", parent_id=first["id"], denoise=0.4
    )
    assert second.json()["assets"][0]["parent_id"] == first["id"]
    assert advanced[0].graphs[-1]["sample"]["inputs"]["denoise"] == 0.4


@pytest.mark.asyncio
async def test_uncertain_submission_never_retries_and_known_job_recovers(
    client, advanced
):
    fake, _, _, _ = advanced
    cid = await conversation(client)
    fake.fail_submit = True
    key = str(uuid4())
    result = await run(client, cid, client_message_id=key)
    assert (
        result.json()["status"] == "needs_recovery" and result.json()["provider_active"]
    ), result.text
    assert (await run(client, cid, client_message_id=key)).status_code == 409
    assert (
        await client.post("/api/studio/jobs/" + result.json()["id"] + "/recover")
    ).status_code == 409
    from luma_core.db import session as db

    async with db.async_session_factory() as session:
        execution = await session.get(StudioExecution, result.json()["id"])
        execution.remote_id = fake.remote_id
        await session.commit()
    fake.fail_submit = False
    recovered = await client.post(
        "/api/studio/jobs/" + result.json()["id"] + "/recover"
    )
    assert (
        recovered.json()["status"] == "completed"
        and len(recovered.json()["assets"]) == 1
    ), recovered.text
    again = await client.post("/api/studio/jobs/" + result.json()["id"] + "/recover")
    assert again.json() == recovered.json()


@pytest.mark.asyncio
async def test_hash_verification_and_unexpected_provider_errors(
    client, advanced, tmp_path
):
    fake, settings, manifest, path = advanced
    root = tmp_path / "weights"
    (root / "checkpoints").mkdir(parents=True)
    (root / "loras").mkdir()
    (root / "checkpoints" / "base.safetensors").write_bytes(b"fixture weights")
    settings.comfyui_model_root = str(root)
    data = (await client.get("/api/studio/catalog")).json()
    base = next(r for r in data["models"] if r["id"] == "base")
    assert not base["ready"]
    manifest["models"][0]["sha256"] = hashlib.sha256(b"fixture weights").hexdigest()
    path.write_text(json.dumps(manifest))
    assert (
        next(
            r
            for r in (await client.get("/api/studio/catalog")).json()["models"]
            if r["id"] == "base"
        )["verification"]
        == "hash-verified"
    )
    fake.fail_output = True
    result = await run(client, await conversation(client))
    assert result.json()["status"] == "failed"
    assert "fixture weights" not in result.text


@pytest.mark.asyncio
async def test_private_opt_in_isolation_lock_expiry_and_purge(client, advanced):
    _, settings, _, _ = advanced
    settings.private_studio_enabled = False
    assert (
        await client.post(
            "/api/private-studio/unlock",
            json={
                "adult_eligible": True,
                "fictional_adults_only": True,
                "accept_law_license_provider_policies": True,
            },
        )
    ).status_code == 404
    settings.private_studio_enabled = True
    assert (
        await client.post(
            "/api/private-studio/unlock",
            json={
                "adult_eligible": False,
                "fictional_adults_only": True,
                "accept_law_license_provider_policies": True,
            },
        )
    ).status_code == 403
    await private_session(client)
    cid = (await client.post("/api/private-studio/workspaces", json={})).json()["id"]
    result = await client.post(
        "/api/private-studio/workspaces/" + cid + "/generate",
        json={
            "client_message_id": str(uuid4()),
            "model": "secret",
            "prompt": "Fictional adult art portrait",
        },
    )
    assert result.status_code == 200 and result.json()["status"] == "completed", (
        result.text
    )
    asset = result.json()["assets"][0]
    assert not (await client.get("/api/conversations")).json()["items"]
    assert (await client.get("/api/conversations/" + cid)).status_code == 404
    assert (await client.get("/api/images/conversations/" + cid)).status_code == 404
    assert (await client.get("/api/images/assets/" + asset["id"])).status_code == 404
    assert (
        await client.get("/api/studio/jobs/" + result.json()["id"])
    ).status_code == 404
    assert not (await client.get("/api/audit-events")).json()["items"]
    assert (
        await client.get("/api/private-studio/assets/" + asset["id"])
    ).status_code == 200
    assert (
        await client.patch(
            "/api/private-studio/workspaces/" + cid, json={"gallery_visible": False}
        )
    ).status_code == 200
    assert not (await client.get("/api/private-studio/workspaces")).json()["items"]
    assert (
        len(
            (
                await client.get("/api/private-studio/workspaces?include_hidden=true")
            ).json()["items"]
        )
        == 1
    )
    await client.post("/api/private-studio/lock")
    assert (
        await client.get("/api/private-studio/assets/" + asset["id"])
    ).status_code == 423
    await private_session(client)
    assert (
        await client.request(
            "DELETE",
            "/api/private-studio/workspaces/" + cid,
            json={"confirm_delete": True},
        )
    ).status_code == 200
    result = await client.post("/api/private-studio/purge")
    assert result.status_code == 200 and result.json()["files_removed"] == 1, (
        result.text
    )
    assert (
        await client.get("/api/private-studio/assets/" + asset["id"])
    ).status_code == 404
    assert not (Path(settings.image_storage_dir) / asset["id"]).exists()
    assert (await client.get("/api/conversations")).json()["items"] == []
    from luma_core.db import session as db

    async with db.async_session_factory() as session:
        row = await session.get(
            StudioUnlock,
            hashlib.sha256(
                client.headers["X-Luma-Studio-Session"].encode()
            ).hexdigest(),
        )
        row.expires_at = "2000-01-01T00:00:00+00:00"
        await session.commit()
    assert (await client.get("/api/private-studio/workspaces")).status_code == 423


@pytest.mark.asyncio
async def test_private_uploads_revisions_cloud_consent_and_wrong_owner(
    client, advanced
):
    await private_session(client)
    cid = (await client.post("/api/private-studio/workspaces", json={})).json()["id"]
    uploaded = await client.post(
        "/api/private-studio/workspaces/" + cid + "/uploads",
        content=picture(),
        headers={"Content-Type": "image/png"},
    )
    assert uploaded.status_code == 201, uploaded.text
    attachment = uploaded.json()["id"]
    assert (await client.get("/api/chat/attachments/" + attachment)).status_code == 404
    result = await client.post(
        "/api/private-studio/workspaces/" + cid + "/generate",
        json={
            "client_message_id": str(uuid4()),
            "model": "base",
            "prompt": "fictional adult character artwork",
            "operation": "image_to_image",
            "reference_attachment_id": attachment,
        },
    )
    assert result.json()["status"] == "completed", result.text
    assert result.json()["assets"][0]["parent_id"]
    assert (
        await client.post(
            "/api/private-studio/workspaces/" + cid + "/generate",
            json={
                "client_message_id": str(uuid4()),
                "engine": "cloud",
                "model": "gpt-image-2",
                "prompt": "artwork",
                "confirm_cloud": True,
            },
        )
    ).status_code == 403
    with patch(
        "luma_core.auth.get_settings",
        return_value=Settings(
            _env_file=None,
            local_owner_token="test-owner-token-12345",
            local_owner_id="other",
        ),
    ):
        assert (
            await client.get("/api/private-studio/workspaces/" + cid)
        ).status_code == 423
    client.headers.clear()
    assert (await client.get("/api/private-studio/workspaces")).status_code == 401


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254",
        "http://192.168.1.20:8188",
        "https://user:pass@example.com",
        "https://example.com/evil",
        "https://example.com/?url=http://bad",
    ],
)
def test_untrusted_endpoints_rejected(url):
    settings = Settings(
        _env_file=None,
        comfyui_enabled=True,
        comfyui_remote_url=url,
        comfyui_trusted_origins=url,
    )
    with pytest.raises(ImageProviderError):
        endpoint(settings, "comfy_remote")


@pytest.mark.asyncio
async def test_native_cancel_and_concurrent_requests(file_client, advanced):
    client, _ = file_client
    fake, settings, _, _ = advanced
    fake.pending = True
    settings.image_max_concurrent = 1
    cid = await conversation(client)
    other = await conversation(client)
    submitted = asyncio.Event()
    original = fake.handle

    def handle(request):
        response = original(request)
        if request.url.path == "/prompt":
            submitted.set()
        return response

    fake.handle = handle
    job = asyncio.create_task(run(client, cid))
    try:
        await asyncio.wait_for(submitted.wait(), 30)
        assert (await run(client, other)).status_code == 409
        data = (await client.get("/api/images/conversations/" + cid)).json()
        identifier = data["jobs"][0]["id"]
        assert (
            await client.post("/api/studio/jobs/" + identifier + "/cancel")
        ).status_code == 200
        assert (await run(client, other)).status_code == 409
    finally:
        fake.pending = False
        result = await job
    assert result.json()["status"] == "cancelled" and not result.json()["assets"]
    assert not result.json()["provider_active"]
    assert not any(r.url.path == "/interrupt" for r in fake.requests)


@pytest.mark.asyncio
async def test_known_remote_timeout_recovery_and_definitive_rejection(client, advanced):
    fake, settings, _, _ = advanced
    fake.pending = True
    settings.comfyui_timeout_seconds = 1
    result = await run(client, await conversation(client))
    assert (
        result.json()["status"] == "needs_recovery" and result.json()["provider_active"]
    )
    fake.pending = False
    recovered = await client.post(
        "/api/studio/jobs/" + result.json()["id"] + "/recover"
    )
    assert recovered.json()["status"] == "completed", recovered.text
    original = fake.handle

    def reject(request):
        if request.url.path == "/prompt":
            return httpx.Response(
                400, json={"node_errors": {"private": "secret error"}}
            )
        return original(request)

    fake.handle = reject
    result = await run(client, await conversation(client))
    assert (
        result.json()["status"] == "failed" and not result.json()["provider_active"]
    ), result.text
    assert "secret error" not in result.text


@pytest.mark.asyncio
async def test_private_scope_cannot_be_reclassified_or_used_by_public_work(
    client, advanced
):
    await private_session(client)
    cid = (await client.post("/api/private-studio/workspaces", json={})).json()["id"]
    assert (
        await client.post(
            "/api/conversations/" + cid + "/messages",
            json={"client_message_id": str(uuid4()), "content": "public task"},
        )
    ).status_code == 404
    assert (
        await client.patch("/api/conversations/" + cid, json={"title": "Make public"})
    ).status_code == 404
    assert (
        await client.post(
            "/api/chat/conversations/" + cid + "/messages",
            json={"client_message_id": str(uuid4()), "content": "secret"},
        )
    ).status_code == 404
    assert (await run(client, cid)).status_code == 404
    assert (await client.get("/api/tasks")).json()["items"] == []
    # Deleting a private workspace never targets an existing ordinary conversation.
    ordinary = await conversation(client)
    assert (
        await client.request(
            "DELETE",
            "/api/private-studio/workspaces/" + ordinary,
            json={"confirm_delete": True},
        )
    ).status_code == 404
    assert (await client.post("/api/private-studio/purge")).json()["files_removed"] == 0
    assert (await client.get("/api/conversations/" + ordinary)).status_code == 200


@pytest.mark.asyncio
async def test_additive_studio_migration_preserves_phase322(tmp_path):
    import sqlite3
    import subprocess
    import sys
    import os
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from luma_core.db.session import Base
    from luma_core.db.migrate import create_tables
    from luma_core.models import Conversation, ConversationMessage
    from luma_core.memory.conversations import now

    path = tmp_path / "phase322.db"
    storage = tmp_path / "images"
    storage.mkdir()
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    previous = [
        t for t in Base.metadata.sorted_tables if not t.name.startswith("studio_")
    ]
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda connection: Base.metadata.create_all(connection, tables=previous)
        )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    cid = str(uuid4())
    aid = str(uuid4())
    jid = str(uuid4())
    async with sessions() as session:
        session.add(
            Conversation(
                id=cid,
                owner_identity="local-owner",
                title="Preserved public gallery",
                created_at=now(),
                updated_at=now(),
            )
        )
        await session.flush()
        message = ConversationMessage(
            conversation_id=cid,
            role="assistant",
            content="Preserved original answer",
            created_at=now(),
        )
        session.add(message)
        await session.flush()
        session.add(
            ImageJob(
                id=jid,
                owner="local-owner",
                conversation_id=cid,
                client_id=str(uuid4()),
                fingerprint="old",
                status="completed",
                provider_active=False,
                model="gpt-image-2",
                created_at=now(),
                usage="{}",
            )
        )
        await session.flush()
        session.add(
            ImageAsset(
                id=aid,
                owner="local-owner",
                conversation_id=cid,
                job_id=jid,
                message_id=message.id,
                mime="image/png",
                created_at=now(),
            )
        )
        await session.commit()
    (storage / aid).write_bytes(picture())

    def snapshot():
        with sqlite3.connect(path) as conn:
            return (
                conn.execute(
                    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name NOT LIKE 'studio_%' ORDER BY type,name"
                ).fetchall(),
                {
                    t.name: conn.execute(
                        f'SELECT * FROM "{t.name}" ORDER BY rowid'
                    ).fetchall()
                    for t in previous
                },
            )

    before = snapshot()
    with patch("luma_core.db.migrate.engine", engine):
        await create_tables()
        await create_tables()
    assert snapshot() == before
    await engine.dispose()
    program = """
import asyncio,httpx,os
from luma_core.app import app
async def run():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Luma-Owner-Token':'restart-test'}) as client:
            data=(await client.get('/api/conversations')).json()['items'];assert len(data)==1
            assert (await client.get('/api/images/assets/'+os.environ['TEST_ASSET'])).content.startswith(b'\\x89PNG')
asyncio.run(run())
"""
    result = await asyncio.to_thread(
        subprocess.run,
        [sys.executable, "-c", program],
        env=dict(
            os.environ,
            DATABASE_URL=f"sqlite:///{path}",
            IMAGE_STORAGE_DIR=str(storage),
            LOCAL_OWNER_TOKEN="restart-test",
            LOCAL_OWNER_ID="local-owner",
            TEST_ASSET=aid,
            APP_DEBUG="false",
        ),
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert snapshot() == before


@pytest.mark.asyncio
async def test_read_only_recovery_races_live_monitor_without_duplicate_results(
    file_client, advanced
):
    client, _ = file_client
    fake, _, _, _ = advanced
    fake.pending = True
    entered = asyncio.Event()
    original = fake.handle

    def handle(request):
        result = original(request)
        if request.url.path.startswith("/history/"):
            entered.set()
        return result

    fake.handle = handle
    cid = await conversation(client)
    job = asyncio.create_task(run(client, cid))
    try:
        await asyncio.wait_for(entered.wait(), 30)
        identifier = (await client.get("/api/images/conversations/" + cid)).json()[
            "jobs"
        ][0]["id"]
        fake.pending = False
        recovered = await client.post("/api/studio/jobs/" + identifier + "/recover")
        assert recovered.json()["status"] == "completed", recovered.text
    finally:
        fake.pending = False
        result = await job
    assert (
        result.json()["status"] == "completed" and not result.json()["provider_active"]
    )
    assert len(result.json()["assets"]) == 1 and len(fake.graphs) == 1
    assert (
        len((await client.get("/api/images/conversations/" + cid)).json()["assets"])
        == 1
    )


@pytest.mark.asyncio
async def test_private_cloud_requires_both_server_and_request_consent(client, advanced):
    _, settings, _, _ = advanced
    await private_session(client)
    cid = (await client.post("/api/private-studio/workspaces", json={})).json()["id"]
    settings.image_provider = "openai"
    settings.private_studio_allow_cloud = True

    class Cloud:
        available = True
        calls = 0

        async def generate(self, *args):
            from luma_core.providers.images import ImageResult

            self.calls += 1
            return ImageResult(((picture(), "image/png"),), "gpt-image-2", {})

    cloud = Cloud()
    body = {
        "client_message_id": str(uuid4()),
        "engine": "cloud",
        "model": "gpt-image-2",
        "prompt": "permitted fictional adult artwork",
    }
    with patch.object(studio, "ImageProvider", return_value=cloud):
        assert (
            await client.post(
                "/api/private-studio/workspaces/" + cid + "/generate", json=body
            )
        ).status_code == 403
        body["confirm_cloud"] = True
        result = await client.post(
            "/api/private-studio/workspaces/" + cid + "/generate", json=body
        )
    assert result.json()["status"] == "completed" and cloud.calls == 1, result.text
    assert (
        await client.get("/api/images/assets/" + result.json()["assets"][0]["id"])
    ).status_code == 404


@pytest.mark.asyncio
async def test_unexpected_catalog_transport_failure_is_controlled(client, advanced):
    fake, _, _, _ = advanced

    def fail(request):
        raise RuntimeError("secret backend error with private path")

    fake.handle = fail
    response = await client.get("/api/studio/catalog")
    assert response.status_code == 200 and not response.json()["available"]
    assert "secret backend" not in response.text
    result = await run(client, await conversation(client))
    assert result.status_code == 503 and "private path" not in result.text


@pytest.mark.asyncio
async def test_optional_websocket_progress_ignores_binary_and_other_jobs(advanced):
    import asyncio

    fake, settings, _, _ = advanced
    job_id = str(uuid4())
    prompt_id = str(uuid4())
    queue = asyncio.Queue(maxsize=1)

    class Socket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def __aiter__(self):
            async def events():
                yield b"private binary preview must not be relayed"
                yield json.dumps(
                    {
                        "type": "progress",
                        "data": {"prompt_id": str(uuid4()), "value": 99, "max": 100},
                    }
                )
                yield json.dumps(
                    {
                        "type": "progress",
                        "data": {"prompt_id": prompt_id, "value": 37, "max": 100},
                    }
                )

            return events()

    with patch("websockets.asyncio.client.connect", return_value=Socket()) as connect:
        await ComfyUI(settings, "comfy_local").websocket_progress(
            job_id, prompt_id, queue
        )
    assert queue.get_nowait() == 37 and queue.empty()
    assert connect.call_args.args[0] == "ws://127.0.0.1:8188/ws?clientId=" + job_id


@pytest.mark.asyncio
@pytest.mark.parametrize("destination", ["ws://169.254.169.254/ws", "wss://untrusted.example/ws"])
async def test_optional_websocket_refuses_handshake_redirects(advanced, destination):
    import asyncio
    from websockets.datastructures import Headers
    from websockets.exceptions import InvalidStatus
    from websockets.http11 import Response

    _, settings, _, _ = advanced
    error = InvalidStatus(Response(302, "Found", Headers({"Location": destination})))
    decisions = []

    class RedirectingConnection:
        def process_redirect(self, failure):
            return destination  # Default client behavior must be overridden.

        async def __aenter__(self):
            decisions.append(self.process_redirect(error))
            raise error

        async def __aexit__(self, *args):
            return False

    with patch("websockets.asyncio.client.connect", return_value=RedirectingConnection()):
        await ComfyUI(settings, "comfy_local").websocket_progress(
            str(uuid4()), str(uuid4()), asyncio.Queue(maxsize=1)
        )
    # The original error is returned, never a redirect URI or a second dial.
    assert decisions == [error]


@pytest.mark.asyncio
async def test_model_metadata_and_prompts_never_echo_configured_comfy_secret(
    client, advanced
):
    from pydantic import SecretStr

    fake, settings, manifest, path = advanced
    settings.comfyui_token = SecretStr("server-private-comfy-key")
    manifest["models"][0]["source"] = (
        "https://weights.example/?token=server-private-comfy-key"
    )
    path.write_text(json.dumps(manifest))
    response = await client.get("/api/studio/catalog")
    assert (
        response.json()["available"] and "server-private-comfy-key" not in response.text
    )
    assert "[REDACTED]" in response.text
    result = await run(
        client, await conversation(client), prompt="Artwork server-private-comfy-key"
    )
    assert result.json()["status"] == "completed", result.text
    assert "server-private-comfy-key" not in json.dumps(fake.graphs)


@pytest.mark.asyncio
async def test_windows_catalog_separators_are_validated_and_preserved_for_comfy(
    client, advanced
):
    fake, _, manifest, path = advanced
    manifest["models"][0]["file"] = "family/base.safetensors"
    path.write_text(json.dumps(manifest))
    original = fake.handle

    def handle(request):
        result = original(request)
        if request.url.path == "/object_info":
            data = result.json()
            data["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0][0] = (
                "family\\base.safetensors"
            )
            return httpx.Response(200, json=data)
        return result

    fake.handle = handle
    catalog = (await client.get("/api/studio/catalog")).json()
    assert next(row for row in catalog["models"] if row["id"] == "base")["ready"]
    result = await run(client, await conversation(client))
    assert result.json()["status"] == "completed", result.text
    assert (
        fake.graphs[-1]["loader"]["inputs"]["ckpt_name"] == "family\\base.safetensors"
    )


@pytest.mark.asyncio
async def test_cancelled_queued_job_without_history_releases_its_slot(
    file_client, advanced
):
    client, _ = file_client
    fake, _, _, _ = advanced
    fake.pending = True
    entered = asyncio.Event()
    original = fake.handle
    removed = False

    def handle(request):
        nonlocal removed
        if request.url.path == "/queue":
            return httpx.Response(
                200,
                json={
                    "queue_running": [],
                    "queue_pending": [] if removed else [[0, fake.remote_id]],
                },
            )
        result = original(request)
        if request.url.path.startswith("/history/"):
            entered.set()
        if request.url.path.endswith("/cancel"):
            removed = True
        return result

    fake.handle = handle
    cid = await conversation(client)
    job = asyncio.create_task(run(client, cid))
    try:
        await asyncio.wait_for(entered.wait(), 30)
        identifier = (await client.get("/api/images/conversations/" + cid)).json()[
            "jobs"
        ][0]["id"]
        assert (
            await client.post("/api/studio/jobs/" + identifier + "/cancel")
        ).status_code == 200
    finally:
        # The backend confirms queue absence; no fabricated history/completion is needed.
        result = await job
    assert (
        result.json()["status"] == "cancelled" and not result.json()["provider_active"]
    ), result.text
    assert result.json()["assets"] == []


@pytest.mark.asyncio
async def test_deleted_workspace_rejects_late_upload_and_generation(client, advanced):
    await private_session(client)
    cid = (await client.post("/api/private-studio/workspaces", json={})).json()["id"]
    entered, release = asyncio.Event(), asyncio.Event()
    original = chat.parse_attachment

    async def parse(data, kind):
        entered.set()
        await release.wait()
        return await original(data, kind)

    with patch.object(chat, "parse_attachment", side_effect=parse):
        upload = asyncio.create_task(
            client.post(
                "/api/private-studio/workspaces/" + cid + "/uploads",
                content=picture(),
                headers={"Content-Type": "image/png"},
            )
        )
        try:
            await asyncio.wait_for(entered.wait(), 30)
            assert (
                await client.request(
                    "DELETE",
                    "/api/private-studio/workspaces/" + cid,
                    json={"confirm_delete": True},
                )
            ).status_code == 200
            await client.post("/api/private-studio/purge")
        finally:
            release.set()
            result = await upload
    assert result.status_code == 404
    assert not any(Path(advanced[1].chat_attachment_dir).iterdir())


@pytest.mark.asyncio
async def test_generation_scope_rechecked_under_writer_lock(client, advanced):
    await private_session(client)
    cid = (await client.post("/api/private-studio/workspaces", json={})).json()["id"]
    entered, release = asyncio.Event(), asyncio.Event()
    original = images.guard_conversation
    calls = 0

    async def guard(session, conversation_id, owner):
        nonlocal calls
        calls += 1
        await original(session, conversation_id, owner)
        if calls == 1:
            entered.set()
            await release.wait()

    with patch.object(images, "guard_conversation", side_effect=guard):
        job = asyncio.create_task(
            client.post(
                "/api/private-studio/workspaces/" + cid + "/generate",
                json={
                    "client_message_id": str(uuid4()),
                    "model": "base",
                    "prompt": "fictional art",
                },
            )
        )
        try:
            await asyncio.wait_for(entered.wait(), 30)
            assert (
                await client.request(
                    "DELETE",
                    "/api/private-studio/workspaces/" + cid,
                    json={"confirm_delete": True},
                )
            ).status_code == 200
        finally:
            release.set()
            result = await job
    assert result.status_code == 404
    assert not advanced[0].graphs


@pytest.mark.asyncio
async def test_cancelled_remote_recovery_and_deleted_purge_use_queue_absence(
    client, advanced
):
    from luma_core.db import session as db
    from luma_core.memory.conversations import now

    fake, settings, _, _ = advanced
    fake.pending = True
    await private_session(client)
    cid = (await client.post("/api/private-studio/workspaces", json={})).json()["id"]
    identifier = str(uuid4())
    async with db.async_session_factory() as session:
        session.add(
            ImageJob(
                id=identifier,
                owner="local-owner",
                conversation_id=cid,
                client_id=str(uuid4()),
                fingerprint="crash-state",
                status="cancelled",
                provider_active=True,
                model="base",
                created_at=now(),
                usage="{}",
            )
        )
        await session.flush()
        session.add(
            StudioExecution(
                job_id=identifier,
                engine="comfy_local",
                remote_id=fake.remote_id,
                stage="needs_recovery",
                recipe="text_to_image:v1",
                parameters=json.dumps(
                    {
                        "endpoint_hash": hashlib.sha256(
                            (settings.comfyui_local_url + "/").encode()
                        ).hexdigest()
                    }
                ),
            )
        )
        await session.commit()
    original = fake.handle

    def handle(request):
        if request.url.path == "/queue":
            return httpx.Response(200, json={"queue_running": [], "queue_pending": []})
        return original(request)

    fake.handle = handle
    recovered = await client.post("/api/private-studio/jobs/" + identifier + "/recover")
    assert (
        recovered.json()["status"] == "cancelled"
        and not recovered.json()["provider_active"]
    ), recovered.text
    # Simulate an old monitor lost after deletion; purge must reconcile without re-submission.
    async with db.async_session_factory() as session:
        job = await session.get(ImageJob, identifier)
        job.provider_active = True
        await session.commit()
    assert (
        await client.request(
            "DELETE",
            "/api/private-studio/workspaces/" + cid,
            json={"confirm_delete": True},
        )
    ).status_code == 200
    result = await client.post("/api/private-studio/purge")
    assert result.json()["workspaces_pending"] == 0, result.text
    assert not fake.graphs


@pytest.mark.asyncio
async def test_malformed_queue_is_uncertain_not_proof_of_cancellation(advanced):
    fake, settings, _, _ = advanced
    original = fake.handle

    def handle(request):
        if request.url.path == "/queue":
            return httpx.Response(
                200,
                json={
                    "queue_running": [{"untrusted": "malformed"}],
                    "queue_pending": [],
                },
            )
        return original(request)

    fake.handle = handle
    with pytest.raises(ImageProviderError, match="queue state unavailable"):
        await ComfyUI(settings, "comfy_local").active(fake.remote_id)
