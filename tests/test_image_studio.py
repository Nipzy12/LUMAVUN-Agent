"""Image Studio regressions: no paid AI requests."""

import asyncio
import base64
import json
import os
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from luma_core.app import app
from luma_core.config import Settings
from luma_core.models import ImageAsset, ImageJob
from luma_core.providers.images import ImageProvider, ImageProviderError, ImageResult
from luma_core.routers import images
from tests import test_executor_review as executor_review_tests

# Register the existing independent-connection fixture without importing its tests.
file_client = executor_review_tests.file_client


def png():
    output = BytesIO()
    Image.new("RGB", (32, 32), "#557568").save(output, format="PNG")
    return output.getvalue()


class Fake:
    available = True

    def __init__(self):
        self.calls = []

    async def generate(self, *args):
        self.calls.append(args)
        return ImageResult(
            ((png(), "image/png"),), args[1], {"cost": 0.02, "total_tokens": 10}
        )


@pytest.fixture
def studio(tmp_path):
    settings = Settings(
        _env_file=None,
        ai_provider="openai",
        image_provider="openai",
        openai_api_key="fake-secret",
        local_owner_token="test-owner-token-12345",
        image_storage_dir=str(tmp_path / "images"),
        chat_attachment_dir=str(tmp_path / "uploads"),
    )
    provider = Fake()
    app.dependency_overrides[images.get_image_provider] = lambda: provider
    with (
        patch.object(images, "get_settings", return_value=settings),
        patch("luma_core.routers.chat.get_settings", return_value=settings),
        patch("luma_core.routers.chat.create_registry") as registry,
    ):
        registry.return_value.get.return_value.is_available = True
        registry.return_value.get.return_value.chat = AsyncMock(
            side_effect=AssertionError(
                "Text provider must not be called in image guard tests"
            )
        )
        yield provider, settings
    app.dependency_overrides.pop(images.get_image_provider, None)


async def cid(client):
    return (await client.post("/api/conversations", json={})).json()["id"]


async def generate(client, conversation, **kwargs):
    return await client.post(
        f"/api/images/conversations/{conversation}/generate",
        json={
            "client_message_id": str(uuid4()),
            "prompt": "A quiet mountain studio",
            "model": "gpt-image-2",
            **kwargs,
        },
    )


@pytest.mark.asyncio
async def test_generate_replay_persistence_and_private_assets(client, studio):
    provider, _settings = studio
    conversation = await cid(client)
    key = str(uuid4())
    response = await generate(client, conversation, client_message_id=key)
    assert response.status_code == 200, response.text
    job = response.json()
    assert job["status"] == "completed" and job["usage"]["cost"] == 0.02
    asset = job["assets"][0]
    assert asset["parent_id"] is None
    assert (await generate(client, conversation, client_message_id=key)).json() == job
    assert len(provider.calls) == 1
    assert (
        await generate(client, conversation, client_message_id=key, prompt="changed")
    ).status_code == 409
    fetched = await client.get("/api/images/assets/" + asset["id"])
    assert fetched.content == png()
    assert fetched.headers["cache-control"] == "no-store"
    assert (
        "attachment"
        in (
            await client.get("/api/images/assets/" + asset["id"] + "?download=true")
        ).headers["content-disposition"]
    )
    detail = (await client.get("/api/conversations/" + conversation)).json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert all(m["task_id"] is None for m in detail["messages"])
    assert "base64" not in json.dumps(detail)
    assert (await client.get("/api/tasks")).json()["items"] == []
    assert (
        len(
            (await client.get("/api/images/conversations/" + conversation)).json()[
                "assets"
            ]
        )
        == 1
    )
    client.headers.clear()
    assert (await client.get("/api/images/assets/" + asset["id"])).status_code == 401
    assert (await client.get("/api/audit-events")).json()["items"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("shared_storage", [False, True])
async def test_upload_edit_iterative_revision_and_cleanup_preserves_original(
    client, studio, shared_storage
):
    provider, settings = studio
    conversation = await cid(client)
    if shared_storage:
        settings.image_storage_dir = settings.chat_attachment_dir
    upload = await client.post(
        "/api/chat/attachments", content=png(), headers={"Content-Type": "image/png"}
    )
    attachment = upload.json()["id"]
    edited = (
        await generate(client, conversation, reference_attachment_id=attachment)
    ).json()
    first = edited["assets"][0]
    assert first["parent_id"]
    second = (await generate(client, conversation, parent_id=first["id"])).json()[
        "assets"
    ][0]
    assert second["parent_id"] == first["id"]
    assert provider.calls[-1][-1] == (png(), "image/png")
    history = (await client.get("/api/images/conversations/" + conversation)).json()
    assert len(history["assets"]) == 3
    from luma_core.db import session as db

    async with db.async_session_factory() as session:
        from luma_core.models import AttachmentRetention

        lease = await session.get(AttachmentRetention, attachment)
        lease.created_at = "2000-01-01T00:00:00+00:00"
        await session.commit()
    os.utime(Path(settings.chat_attachment_dir) / attachment, (1, 1))
    for asset in history["assets"]:
        os.utime(Path(settings.image_storage_dir) / asset["id"], (1, 1))
    assert (await client.post("/api/chat/attachments/cleanup")).json()[
        "expired_attachments_removed"
    ] == 0
    for asset in history["assets"]:
        os.utime(Path(settings.image_storage_dir) / asset["id"], (1, 1))
    orphan = Path(settings.image_storage_dir) / str(uuid4())
    orphan.write_bytes(b"unused")
    os.utime(orphan, (1, 1))
    unrelated = Path(settings.image_storage_dir) / "keep.txt"
    unrelated.write_text("keep")
    assert (await client.post("/api/images/cleanup")).json()[
        "orphan_files_removed"
    ] == 1
    assert unrelated.is_file()
    assert (
        len(
            (await client.get("/api/images/conversations/" + conversation)).json()[
                "assets"
            ]
        )
        == 3
    )
    for asset in history["assets"]:
        assert (
            await client.get("/api/images/assets/" + asset["id"])
        ).status_code == 200
    assert (Path(settings.chat_attachment_dir) / attachment).read_bytes() == png()


@pytest.mark.asyncio
async def test_owner_and_conversation_isolation(client, studio):
    a, b = await cid(client), await cid(client)
    asset = (await generate(client, a)).json()["assets"][0]
    assert (await generate(client, b, parent_id=asset["id"])).status_code == 404
    with patch(
        "luma_core.auth.get_settings",
        return_value=Settings(
            _env_file=None,
            local_owner_token="test-owner-token-12345",
            local_owner_id="other",
        ),
    ):
        assert (
            await client.get("/api/images/assets/" + asset["id"])
        ).status_code == 404
        assert (await client.get("/api/images/conversations/" + a)).status_code == 404
        assert (await generate(client, a)).status_code == 404
        assert (await client.get("/api/audit-events")).json()["items"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [
        {"model": "gpt-4o-mini"},
        {"mask": "bad"},
        {"quality": "ultra"},
        {"aspect_ratio": "4:3"},
        {"n": 2},
        {"parent_id": str(uuid4())},
        {"prompt": " "},
    ],
)
async def test_capability_and_input_validation(client, studio, override):
    assert (await generate(client, await cid(client), **override)).status_code in (
        404,
        422,
    )
    assert not studio[0].calls


@pytest.mark.asyncio
async def test_no_reference_model_rejected(client, studio):
    with patch.dict(
        images.MODELS["openai"], {"gpt-image-2": {"reference": False, "max_n": 1}}
    ):
        assert (
            await generate(client, await cid(client), parent_id=str(uuid4()))
        ).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", ["error", "refused", "timeout", "invalid", "oversize", "svg"]
)
async def test_failures_no_automatic_paid_retry(client, studio, failure):
    provider, settings = studio

    async def fail(*args):
        provider.calls.append(args)
        if failure == "refused":
            raise ImageProviderError("refused secret raw response")
        if failure == "error":
            raise RuntimeError("fake-secret private response")
        if failure == "timeout":
            await asyncio.Event().wait()
        return ImageResult(
            (
                (
                    b"x" * (settings.image_max_output_bytes + 1)
                    if failure == "oversize"
                    else b"bad",
                    "image/svg+xml" if failure == "svg" else "image/png",
                ),
            ),
            args[1],
            {},
        )

    provider.generate = fail
    settings.image_timeout_seconds = 0.01 if failure == "timeout" else 30
    conversation = await cid(client)
    key = str(uuid4())
    response = await generate(client, conversation, client_message_id=key)
    assert response.status_code == 200 and response.json()["status"] == "failed"
    assert "fake-secret" not in response.text and "raw response" not in response.text
    assert not response.json()["assets"]
    assert (
        await generate(client, conversation, client_message_id=key)
    ).status_code == 409
    assert len(provider.calls) == 1
    assert (
        len((await client.get("/api/conversations/" + conversation)).json()["messages"])
        == 1
    )


@pytest.mark.asyncio
async def test_active_job_blocks_chat_work_duplicates_and_cancel_wins(client, studio):
    provider, _ = studio
    conversation = await cid(client)
    key = str(uuid4())
    entered, release = asyncio.Event(), asyncio.Event()

    async def pending(*args):
        provider.calls.append(args)
        entered.set()
        await release.wait()
        return ImageResult(((png(), "image/png"),), args[1], {})

    provider.generate = pending
    job_request = asyncio.create_task(
        generate(client, conversation, client_message_id=key)
    )
    try:
        await asyncio.wait_for(entered.wait(), 30)
        data = (await client.get("/api/images/conversations/" + conversation)).json()
        job = data["jobs"][0]
        assert (
            await generate(client, conversation, client_message_id=key)
        ).status_code == 409
        assert (
            await client.post(
                f"/api/chat/conversations/{conversation}/messages",
                json={"client_message_id": str(uuid4()), "content": "blocked"},
            )
        ).status_code == 409
        assert (
            await client.post(
                f"/api/conversations/{conversation}/messages",
                json={"client_message_id": str(uuid4()), "content": "blocked"},
            )
        ).status_code == 409
        assert (
            await client.post("/api/images/jobs/" + job["id"] + "/cancel")
        ).status_code == 200
        assert (
            await client.post("/api/images/jobs/" + job["id"] + "/cancel")
        ).status_code == 409
        assert (await generate(client, conversation)).status_code == 409
    finally:
        release.set()
        response = await job_request
    assert response.json()["status"] == "cancelled" and not response.json()["assets"]
    assert not response.json()["provider_active"]
    assert (
        len((await client.get("/api/conversations/" + conversation)).json()["messages"])
        == 1
    )


@pytest.mark.asyncio
async def test_existing_work_requires_approval_and_blocks_image_call(client, studio):
    conversation = await cid(client)
    task = (
        await client.post(
            f"/api/conversations/{conversation}/messages",
            json={"content": "Work", "client_message_id": str(uuid4())},
        )
    ).json()["task"]
    assert (await generate(client, conversation)).status_code == 409
    assert (
        await client.post(f"/api/tasks/{task['id']}/execute", json={"approval_id": 1})
    ).status_code != 200
    assert not studio[0].calls


@pytest.mark.asyncio
async def test_secret_redaction_and_unavailable(client, studio):
    provider, _ = studio
    conversation = await cid(client)
    provider.available = False
    assert (await generate(client, conversation)).status_code == 503
    provider.available = True
    assert (
        await generate(client, conversation, prompt="Draw fake-secret")
    ).status_code == 200
    assert "fake-secret" not in str(provider.calls)
    assert (
        "fake-secret"
        not in (await client.get("/api/conversations/" + conversation)).text
    )
    assert (await client.get("/api/images/models")).json()["available"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,edit",
    [("openai", False), ("openai", True), ("openrouter", False), ("openrouter", True)],
)
async def test_adapter_api_contract_and_usage(provider, edit):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "b64_json": base64.b64encode(png()).decode(),
                        "media_type": "image/png",
                    }
                ],
                "usage": {"cost": 0.1, "total_tokens": 5, "raw_secret": "never retain"},
            },
        )

    settings = Settings(
        _env_file=None,
        image_provider=provider,
        openai_api_key="fake-secret",
        openrouter_api_key="fake-secret",
    )
    model = getattr(settings, provider + "_image_model")
    original = httpx.AsyncClient
    with patch(
        "httpx.AsyncClient",
        side_effect=lambda **kwargs: original(
            transport=httpx.MockTransport(handler), **kwargs
        ),
    ):
        result = await ImageProvider(settings).generate(
            "image", model, "medium", "16:9", 1, (png(), "image/png") if edit else None
        )
    assert (
        result.model == model
        and result.images[0][0] == png()
        and result.usage == {"cost": 0.1, "total_tokens": 5}
    )
    path = seen[0].url.path
    assert (
        path == ("/v1/images/edits" if edit else "/v1/images/generations")
        if provider == "openai"
        else path == "/api/v1/images"
    )
    if provider == "openrouter":
        payload = json.loads(seen[0].content)
        assert bool(payload.get("input_references")) == edit
        assert payload["aspect_ratio"] == "16:9"
    elif edit:
        assert b'name="image"' in seen[0].content
    else:
        assert json.loads(seen[0].content)["size"] == "1536x864"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, text="fake-secret"),
        httpx.Response(403, text="private reason"),
        httpx.Response(200, json={"data": []}),
        httpx.Response(200, json={"data": [{"url": "http://internal/"}]}),
    ],
)
async def test_adapter_sanitizes_and_never_downloads_provider_urls(response):
    calls = []

    def handler(request):
        calls.append(request)
        return response

    original = httpx.AsyncClient
    settings = Settings(
        _env_file=None, image_provider="openai", openai_api_key="fake-secret"
    )
    with patch(
        "httpx.AsyncClient",
        side_effect=lambda **kwargs: original(
            transport=httpx.MockTransport(handler), **kwargs
        ),
    ):
        with pytest.raises(ImageProviderError) as error:
            await ImageProvider(settings).generate(
                "image", "gpt-image-2", "medium", "1:1", 1
            )
    assert "fake-secret" not in str(error.value) and "private reason" not in str(
        error.value
    )
    assert len(calls) == 1


# Independent SQLite connections exercise atomic claims rather than relying on a single in-memory connection.


@pytest.mark.asyncio
@pytest.mark.parametrize("late_error", [False, True])
async def test_file_database_global_concurrency_and_cancel(
    file_client, studio, late_error
):
    client, _ = file_client
    provider, settings = studio
    settings.image_max_concurrent = 1
    a, b = await cid(client), await cid(client)
    entered, release = asyncio.Event(), asyncio.Event()

    async def pending(*args):
        provider.calls.append(args)
        entered.set()
        await release.wait()
        if late_error:
            raise RuntimeError("late failure")
        return ImageResult(((png(), "image/png"),), args[1], {"cost": 0.02})

    provider.generate = pending
    job = asyncio.create_task(generate(client, a))
    try:
        await asyncio.wait_for(entered.wait(), 30)
        assert (await generate(client, b)).status_code == 409
        job_id = (await client.get("/api/images/conversations/" + a)).json()["jobs"][0][
            "id"
        ]
        assert (
            await client.post("/api/images/jobs/" + job_id + "/cancel")
        ).status_code == 200
        assert (await generate(client, b)).status_code == 409
    finally:
        release.set()
        response = await job
    assert response.json()["status"] == "cancelled" and not response.json()["assets"]
    assert not response.json()["provider_active"]
    actions = [
        e["action"] for e in (await client.get("/api/audit-events")).json()["items"]
    ]
    assert actions.count("image_generation_discarded") == 1
    assert (
        "image_generation_completed" not in actions
        and "image_generation_failed" not in actions
    )
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_image_migration_and_process_restart(tmp_path):
    import sqlite3
    import subprocess
    import sys

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from luma_core.db.migrate import create_tables
    from luma_core.db.session import Base
    from luma_core.models import (
        AttachmentRetention,
        ChatAttachment,
        ChatRequest,
        Conversation,
        ConversationMessage,
    )

    dbpath = tmp_path / "phase321.db"
    store = tmp_path / "images"
    store.mkdir()
    engine = create_async_engine(f"sqlite+aiosqlite:///{dbpath}")
    previous = [
        t
        for t in Base.metadata.sorted_tables
        if t.name not in ("image_jobs", "image_assets")
        and not t.name.startswith("studio_")
    ]
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda conn: Base.metadata.create_all(conn, tables=previous)
        )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    conversation = str(uuid4())
    attachment = str(uuid4())
    async with sessions() as session:
        session.add(
            Conversation(
                id=conversation,
                owner_identity="local-owner",
                title="Original conversation",
                created_at="before",
                updated_at="before",
            )
        )
        session.add(
            ConversationMessage(
                conversation_id=conversation,
                role="assistant",
                content="Preserved answer",
                created_at="before",
            )
        )
        session.add(
            ChatAttachment(
                id=attachment,
                owner="local-owner",
                kind="image/png",
                name="original",
                text="",
                conversation_id=conversation,
            )
        )
        session.add(
            ChatRequest(
                id=str(uuid4()),
                conversation_id=conversation,
                client_id=str(uuid4()),
                fingerprint="old",
                status="completed",
            )
        )
        session.add(AttachmentRetention(attachment_id=attachment, created_at="before"))
        await session.commit()

    def snapshot():
        with sqlite3.connect(dbpath) as conn:
            return (
                conn.execute(
                    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name NOT IN ('image_jobs','image_assets') AND tbl_name NOT LIKE 'studio_%' ORDER BY type,name"
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
    asset_id = str(uuid4())
    job_id = str(uuid4())
    async with sessions() as session:
        session.add(
            ImageJob(
                id=job_id,
                owner="local-owner",
                conversation_id=conversation,
                client_id=str(uuid4()),
                fingerprint="saved",
                status="completed",
                provider_active=False,
                model="gpt-image-2",
                created_at="now",
                usage="{}",
            )
        )
        await session.flush()
        session.add(
            ImageAsset(
                id=asset_id,
                owner="local-owner",
                conversation_id=conversation,
                job_id=job_id,
                mime="image/png",
                created_at="now",
            )
        )
        await session.commit()
    (store / asset_id).write_bytes(png())
    await engine.dispose()
    program = """
import asyncio, httpx, os
from luma_core.app import app
async def run():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'X-Luma-Owner-Token':'restart-owner'}) as client:
            history=(await client.get('/api/images/conversations/'+os.environ['TEST_CONVERSATION'])).json()
            assert len(history['assets'])==1
            response=await client.get('/api/images/assets/'+history['assets'][0]['id'])
            assert response.status_code==200 and response.content.startswith(b'\\x89PNG')
asyncio.run(run())
"""
    env = dict(
        os.environ,
        DATABASE_URL=f"sqlite:///{dbpath}",
        IMAGE_STORAGE_DIR=str(store),
        LOCAL_OWNER_TOKEN="restart-owner",
        LOCAL_OWNER_ID="local-owner",
        TEST_CONVERSATION=conversation,
        APP_DEBUG="false",
    )
    result = await asyncio.to_thread(
        subprocess.run,
        [sys.executable, "-c", program],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert snapshot() == before


@pytest.mark.asyncio
async def test_output_stream_budget_and_transport_timeout():
    original = httpx.AsyncClient
    for failure in ("large", "timeout"):

        def handler(request, failure=failure):
            if failure == "timeout":
                raise httpx.ReadTimeout("fake-secret")
            return httpx.Response(200, content=b"x" * 100000)

        settings = Settings(
            _env_file=None,
            image_provider="openai",
            openai_api_key="fake-secret",
            image_max_output_bytes=1024,
        )
        with patch(
            "httpx.AsyncClient",
            side_effect=lambda **kw: original(
                transport=httpx.MockTransport(handler), **kw
            ),
        ):
            with pytest.raises(
                ImageProviderError,
                match="^Image provider request failed; no automatic retry was made$",
            ):
                await ImageProvider(settings).generate(
                    "image", "gpt-image-2", "medium", "1:1", 1
                )


@pytest.mark.asyncio
async def test_reference_file_budget_and_malformed_file(client, studio):
    conversation = await cid(client)
    asset = (await generate(client, conversation)).json()["assets"][0]
    path = Path(studio[1].image_storage_dir) / asset["id"]
    path.write_bytes(b"x" * (studio[1].image_max_output_bytes + 1))
    assert (
        await generate(client, conversation, parent_id=asset["id"])
    ).status_code == 422
    path.write_bytes(b"not an image")
    assert (
        await generate(client, conversation, parent_id=asset["id"])
    ).status_code == 422
    assert len(studio[0].calls) == 1


@pytest.mark.asyncio
async def test_message_ids_shared_across_chat_and_images_are_not_recharged(
    client, studio
):
    conversation = await cid(client)
    key = str(uuid4())
    assert (
        await generate(client, conversation, client_message_id=key)
    ).status_code == 200
    response = await client.post(
        f"/api/chat/conversations/{conversation}/messages",
        json={"client_message_id": key, "content": "same id"},
    )
    assert response.status_code == 409
    assert len(studio[0].calls) == 1
    other = str(uuid4())
    # Existing Work requests also bind their message IDs; Image Studio cannot reuse them.
    result = await client.post(
        f"/api/conversations/{conversation}/messages",
        json={"client_message_id": other, "content": "governed task"},
    )
    assert result.status_code == 201
    assert (
        await generate(client, conversation, client_message_id=other)
    ).status_code == 409


@pytest.mark.asyncio
async def test_image_validation_does_not_echo_secret_and_malformed_legacy_audit_survives(
    client, studio
):
    from luma_core.db import session as db
    from luma_core.models import AuditEvent

    async with db.async_session_factory() as session:
        session.add(
            AuditEvent(
                action="legacy",
                occurred_at="before",
                metadata_="legacy non-json metadata",
            )
        )
        await session.commit()
    response = await generate(client, await cid(client), prompt="fake-secret" * 500)
    assert response.status_code == 422 and "fake-secret" not in response.text
    assert (await client.get("/api/audit-events")).status_code == 200
