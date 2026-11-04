from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from luma_core.app import app
from luma_core.agents.executor import get_execution_provider
from luma_core.providers.base import ProviderResponse
from luma_core.providers.openai import OpenAIProvider
from luma_core.config import Settings


async def prepare(client):
    await client.post('/api/agents', json={'name': 'Writer', 'job_type': 'backend engineer'})
    task = (await client.post('/api/tasks', json={'title': 'Draft design', 'job_type': 'backend engineer'})).json()
    approval = (await client.post('/api/approval-requests', json={
        'action': 'execute_task', 'target_type': 'task', 'target_id': task['id']})).json()
    await client.post(f"/api/approval-requests/{approval['id']}/approve")
    return task['id'], approval['id']


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [False, True])
async def test_execution_persists_and_consumes_approval(client, failure):
    task, approval = await prepare(client)
    async def chat(prompt):
        assert (await client.get(f'/api/tasks/{task}')).json()['status'] == 'in_progress'
        if failure:
            raise RuntimeError('SECRET-KEY must never leak')
        return ProviderResponse(text='Draft result')
    provider = Mock(is_available=True, chat=AsyncMock(side_effect=chat))
    app.dependency_overrides[get_execution_provider] = lambda: provider
    response = await client.post(f'/api/tasks/{task}/execute', json={'approval_id': approval})
    assert response.status_code == 200
    data = (await client.get(f'/api/tasks/{task}')).json()
    assert data['status'] == ('failed' if failure else 'completed')
    assert data['result'] == (None if failure else 'Draft result')
    assert bool(data['error']) == failure
    assert 'SECRET-KEY' not in str(data)
    assert (await client.post(f'/api/tasks/{task}/execute', json={'approval_id': approval})).status_code == 403
    assert provider.chat.await_count == 1
    events = (await client.get('/api/audit-events')).json()['items']
    assert any(e['action'] == 'task_execution_started' for e in events)


@pytest.mark.asyncio
async def test_auth_approval_and_unavailable(client):
    task, approval = await prepare(client)
    provider = Mock(is_available=False, chat=AsyncMock())
    app.dependency_overrides[get_execution_provider] = lambda: provider
    path = f'/api/tasks/{task}/execute'
    assert (await client.post(path, json={'approval_id': approval}, headers={'X-Luma-Owner-Token': ''})).status_code == 401
    assert (await client.post(path, json={'approval_id': 999})).status_code == 403
    assert (await client.post(path, json={'approval_id': approval})).status_code == 503
    assert (await client.get(f'/api/tasks/{task}')).json()['status'] == 'assigned'
    provider.chat.assert_not_called()


@pytest.mark.asyncio
async def test_wrong_task_and_nonassigned(client):
    task, approval = await prepare(client)
    provider = Mock(is_available=True, chat=AsyncMock())
    app.dependency_overrides[get_execution_provider] = lambda: provider
    assert (await client.post(f'/api/tasks/{task+1}/execute', json={'approval_id': approval})).status_code == 403
    await client.patch(f'/api/tasks/{task}', json={'status': 'cancelled'})
    assert (await client.post(f'/api/tasks/{task}/execute', json={'approval_id': approval})).status_code == 409
    provider.chat.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', [False, True])
async def test_openai_adapter(bad):
    settings = Settings(openai_api_key='fake-secret', ai_provider='openai')
    provider = OpenAIProvider(settings)
    response = httpx.Response(401 if bad else 200, request=httpx.Request('POST', 'https://api.openai.com'),
                             json={'choices': [{'message': {'content': 'hello'}}]})
    transport = AsyncMock()
    transport.post.return_value = response
    with patch('luma_core.providers.openai.httpx.AsyncClient') as constructor:
        constructor.return_value.__aenter__.return_value = transport
        if bad:
            with pytest.raises(RuntimeError, match='Cloud provider request failed'):
                await provider.chat('test')
        else:
            assert (await provider.chat('test')).text == 'hello'
        payload = transport.post.call_args.kwargs['json']
        assert 'tools' not in payload
    assert 'fake-secret' not in repr(settings)
