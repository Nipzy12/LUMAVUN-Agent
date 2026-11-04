"""Security and concurrency regression tests on independent SQLite connections."""
import asyncio
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from luma_core.app import app
from luma_core.auth import get_owner_token
from luma_core.config import Settings
from luma_core.db.session import Base, get_db
from luma_core.agents.executor import get_execution_provider
from luma_core.providers.registry import create_registry
from luma_core.providers.base import ProviderResponse
from luma_core.models import Task, ApprovalRequest, AuditEvent


@pytest_asyncio.fixture
async def file_client(tmp_path):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "review.db"}')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async def db():
        async with sessions() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise
    app.dependency_overrides[get_db] = db
    settings = Settings(_env_file=None, local_owner_token='owner-test')
    try:
        with patch('luma_core.auth.get_settings', return_value=settings):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                         headers={'X-Luma-Owner-Token': 'owner-test'}) as client:
                yield client, sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def approval(client, task, **overrides):
    data = dict(action='execute_task', target_type='task', target_id=task)
    data.update(overrides)
    response = await client.post('/api/approval-requests', json=data)
    assert response.status_code == 201
    aid = response.json()['id']
    await client.post(f'/api/approval-requests/{aid}/approve')
    return aid


async def seed(client):
    assert (await client.post('/api/agents', json={'name': 'Worker', 'job_type': 'backend engineer'})).status_code == 201
    response = await client.post('/api/tasks', json={'title': 'Safe text', 'job_type': 'backend engineer'})
    assert response.status_code == 201
    tid = response.json()['id']
    return tid, await approval(client, tid)


@pytest.mark.asyncio
@pytest.mark.parametrize('same_approval', [True, False])
async def test_simultaneous_requests_make_one_call(file_client, same_approval):
    client, sessions = file_client
    tid, aid = await seed(client)
    second = aid if same_approval else await approval(client, tid)
    entered, release = asyncio.Event(), asyncio.Event()
    async def chat(prompt):
        entered.set()
        await release.wait()
        return ProviderResponse('done')
    provider = Mock(is_available=True, chat=AsyncMock(side_effect=chat))
    app.dependency_overrides[get_execution_provider] = lambda: provider
    async def run(a):
        return await client.post(f'/api/tasks/{tid}/execute', json={'approval_id': a})
    jobs = [asyncio.create_task(run(a)) for a in (aid, second)]
    try:
        await asyncio.wait_for(entered.wait(), 5)
        done, pending = await asyncio.wait(jobs, timeout=5, return_when=asyncio.FIRST_COMPLETED)
        assert len(done) == 1 and len(pending) == 1
        assert next(iter(done)).result().status_code in (403, 409)
        assert (await client.get(f'/api/tasks/{tid}')).json()['status'] == 'in_progress'
        # Manual reset must not create another active execution.
        reset = await client.patch(f'/api/tasks/{tid}', json={'status': 'failed'})
        assert reset.status_code == 409
    finally:
        release.set()
        results = await asyncio.gather(*jobs)
    assert sorted(r.status_code for r in results)[0] == 200
    assert provider.chat.await_count == 1
    async with sessions() as session:
        task = await session.get(Task, tid)
        assert task.status.value == 'completed' and task.result == 'done'
        actions = list((await session.scalars(select(AuditEvent.action))).all())
        assert actions.count('task_execution_started') == 1
        assert actions.count('task_execution_completed') == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['pending', 'denied', 'wrong_action', 'wrong_type', 'wrong_task'])
async def test_approval_binding(file_client, kind):
    client, sessions = file_client
    tid, aid = await seed(client)
    if kind.startswith('wrong'):
        overrides = {'wrong_action': {'action': 'run_shell'}, 'wrong_type': {'target_type': 'agent'},
                     'wrong_task': {'target_id': tid + 1}}
        aid = await approval(client, tid, **overrides[kind])
    else:
        from luma_core.models import ApprovalStatus
        async with sessions() as session:
            record = await session.get(ApprovalRequest, aid)
            record.status = ApprovalStatus(kind)
            await session.commit()
    provider = Mock(is_available=True, chat=AsyncMock())
    app.dependency_overrides[get_execution_provider] = lambda: provider
    assert (await client.post(f'/api/tasks/{tid}/execute', json={'approval_id': aid})).status_code == 403
    assert (await client.get(f'/api/tasks/{tid}')).json()['status'] == 'assigned'
    provider.chat.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize('token', ['', 'wrong-token'])
async def test_owner_required(file_client, token):
    client, _ = file_client
    tid, aid = await seed(client)
    provider = Mock(is_available=True, chat=AsyncMock())
    app.dependency_overrides[get_execution_provider] = lambda: provider
    headers = {'X-Luma-Owner-Token': token}
    for path, body in [(f'/api/tasks/{tid}/execute', {'approval_id': aid}),
                       (f'/api/approval-requests/{aid}/approve', {})]:
        assert (await client.post(path, json=body, headers=headers)).status_code == 401
    provider.chat.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize('settings', [Settings(_env_file=None),
    Settings(_env_file=None, ai_provider='openai'),
    Settings(_env_file=None, ai_provider='openai', openai_api_key='   ')])
async def test_unavailable_preserves_approval_and_task(file_client, settings):
    client, _ = file_client
    tid, aid = await seed(client)
    app.dependency_overrides[get_execution_provider] = lambda: create_registry(settings).get()
    assert (await client.post(f'/api/tasks/{tid}/execute', json={'approval_id': aid})).status_code == 503
    assert (await client.get(f'/api/tasks/{tid}')).json()['status'] == 'assigned'
    assert (await client.get(f'/api/approval-requests/{aid}')).json()['status'] == 'approved'


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome', ['error', 'timeout', 'empty', 'cancel'])
async def test_failure_and_cancellation_audit(file_client, outcome):
    client, sessions = file_client
    tid, aid = await seed(client)
    async def chat(prompt):
        if outcome == 'error':
            raise RuntimeError('Bearer TOP-SECRET raw provider body')
        if outcome == 'timeout':
            await asyncio.sleep(10)
        if outcome == 'cancel':
            assert (await client.patch(f'/api/tasks/{tid}', json={'status': 'cancelled'})).status_code == 200
            return ProviderResponse('discard this result')
        return ProviderResponse('')
    provider = Mock(is_available=True, chat=AsyncMock(side_effect=chat))
    app.dependency_overrides[get_execution_provider] = lambda: provider
    with patch('luma_core.agents.executor.get_settings', return_value=Settings(_env_file=None, ai_timeout_seconds=0.1)):
        response = await client.post(f'/api/tasks/{tid}/execute', json={'approval_id': aid})
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == ('cancelled' if outcome == 'cancel' else 'failed')
    assert data['result'] is None
    audit = (await client.get('/api/audit-events')).json()
    assert 'TOP-SECRET' not in str(data) + str(audit)
    actions = [e['action'] for e in audit['items']]
    assert 'task_execution_started' in actions
    assert ('task_execution_discarded' if outcome == 'cancel' else 'task_execution_failed') in actions
    async with sessions() as session:
        saved = await session.get(Task, tid)
        assert saved.status.value == data['status']
        assert saved.error == data['error']


@pytest.mark.asyncio
async def test_competing_approval_decisions(file_client):
    client, sessions = file_client
    response = await client.post('/api/approval-requests', json={
        'action': 'execute_task', 'target_type': 'task', 'target_id': 1})
    aid = response.json()['id']
    results = await asyncio.gather(*(client.post(f'/api/approval-requests/{aid}/{decision}')
                                     for decision in ('approve', 'deny')))
    assert sorted(r.status_code for r in results) == [200, 400]
    async with sessions() as session:
        decisions = (await session.scalars(select(AuditEvent).where(
            AuditEvent.action.in_(['approval_granted', 'approval_denied'])))).all()
        assert len(decisions) == 1


@pytest.mark.asyncio
async def test_unconfigured_owner_cannot_execute(file_client):
    client, _ = file_client
    tid, aid = await seed(client)
    with patch('luma_core.auth.get_settings', return_value=Settings(_env_file=None)):
        response = await client.post(f'/api/tasks/{tid}/execute', json={'approval_id': aid})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_adapter_redacts_echoed_key():
    from luma_core.providers.openai import OpenAIProvider
    settings = Settings(_env_file=None, openai_api_key='sk-disposable-test-secret')
    transport = AsyncMock()
    transport.post.return_value = httpx.Response(200, request=httpx.Request('POST', 'https://api.openai.com'),
        json={'choices': [{'message': {'content': 'echo sk-disposable-test-secret'}}]})
    with patch('luma_core.providers.openai.httpx.AsyncClient') as constructor:
        constructor.return_value.__aenter__.return_value = transport
        response = await OpenAIProvider(settings).chat('test')
    assert response.text == 'echo [REDACTED]'


@pytest.mark.asyncio
@pytest.mark.parametrize('body', [{}, {'choices': []}, {'choices': [{'message': {'content': None}}]}])
async def test_adapter_rejects_malformed_response(body):
    from luma_core.providers.openai import OpenAIProvider
    transport = AsyncMock()
    transport.post.return_value = httpx.Response(200, request=httpx.Request('POST', 'https://api.openai.com'), json=body)
    with patch('luma_core.providers.openai.httpx.AsyncClient') as constructor:
        constructor.return_value.__aenter__.return_value = transport
        with pytest.raises(RuntimeError, match='^Cloud provider request failed$'):
            await OpenAIProvider(Settings(_env_file=None, openai_api_key='test-key')).chat('test')
