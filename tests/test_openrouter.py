"""OpenRouter contract tests: every provider HTTP request is mocked."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic import SecretStr

from luma_core.app import app
from luma_core.agents.executor import get_execution_provider
from luma_core.config import Settings
from luma_core.providers.base import UnavailableProvider
from luma_core.providers.openai import OpenAIProvider
from luma_core.providers.openrouter import OpenRouterProvider
from luma_core.providers.registry import create_registry

KEY = 'fake-openrouter-secret'
ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'


def settings(**values):
    return Settings(_env_file=None, ai_provider='openrouter', openrouter_api_key=KEY, **values)


def response(status=200, body=None):
    return httpx.Response(status, request=httpx.Request('POST', ENDPOINT),
                          json=body if body is not None else {'choices': [{'message': {'content': 'Safe answer'}}]})


def mocked_http(result):
    transport = AsyncMock()
    if isinstance(result, Exception):
        transport.post.side_effect = result
    else:
        transport.post.return_value = result
    mock = patch('luma_core.providers.openrouter.httpx.AsyncClient')
    return mock, transport


@pytest.mark.asyncio
async def test_success_request_contract_and_key_redaction():
    config = settings(openrouter_model='vendor/test-model', ai_max_output_tokens=80, ai_timeout_seconds=5)
    adapter = OpenRouterProvider(config)
    mock, transport = mocked_http(response(body={'choices': [{'message': {'content': f'answer {KEY}'}}]}))
    with mock as constructor:
        constructor.return_value.__aenter__.return_value = transport
        result = await adapter.chat('Write a sentence')
        constructor.assert_called_once_with(timeout=5)
    assert result.text == 'answer [REDACTED]' and result.model == 'vendor/test-model'
    transport.post.assert_awaited_once()
    args, kwargs = transport.post.call_args
    assert args == (ENDPOINT,)
    assert kwargs['headers'] == {'Authorization': f'Bearer {KEY}'}
    assert kwargs['json']['model'] == 'vendor/test-model'
    assert kwargs['json']['max_tokens'] == 80
    assert kwargs['json']['messages'][-1] == {'role': 'user', 'content': 'Write a sentence'}
    assert not {'tools', 'stream', 'max_completion_tokens'} & kwargs['json'].keys()
    assert isinstance(config.openrouter_api_key, SecretStr)
    assert KEY not in repr(config) + config.model_dump_json()


@pytest.mark.asyncio
@pytest.mark.parametrize('result', [
    response(401, {'error': {'message': KEY}}),
    response(403, {'error': {'message': KEY}}),
    response(429, {'error': {'message': KEY}}),
    response(500, {'error': {'message': KEY}}),
    httpx.ReadTimeout(KEY), httpx.ConnectError(KEY),
    httpx.Response(200, request=httpx.Request('POST', ENDPOINT), content=b'not JSON'),
    response(body={'choices': []}),
    response(body={'choices': [{'message': {'content': None}}]}),
    response(body={'choices': [{'message': {'content': '  '}}]}),
    response(body={'choices': [{'message': {'content': ['not text']}}]}),
    response(body={'error': {'message': KEY}, 'choices': [{'message': {'content': KEY}}]}),
])
async def test_errors_sanitized_without_retry(result):
    mock, transport = mocked_http(result)
    with mock as constructor:
        constructor.return_value.__aenter__.return_value = transport
        with pytest.raises(RuntimeError, match='^Cloud provider request failed$') as exc:
            await OpenRouterProvider(settings()).chat('test')
    assert KEY not in str(exc.value)
    assert exc.value.__suppress_context__
    transport.post.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize('key', [None, '', '   '])
async def test_missing_key_never_creates_http_client(key):
    adapter = OpenRouterProvider(Settings(_env_file=None, ai_provider='openrouter', openrouter_api_key=key))
    with patch('luma_core.providers.openrouter.httpx.AsyncClient') as constructor:
        assert not adapter.is_available
        with pytest.raises(RuntimeError, match='Cloud provider is not configured'):
            await adapter.chat('test')
        constructor.assert_not_called()


def test_registry_and_dotenv(tmp_path):
    env = tmp_path / '.env'
    env.write_text(f'AI_PROVIDER=openrouter\nOPENROUTER_API_KEY={KEY}\nOPENROUTER_MODEL=vendor/custom\n')
    config = Settings(_env_file=env)
    assert isinstance(create_registry(config).get(), OpenRouterProvider)
    assert config.openrouter_model == 'vendor/custom'
    assert config.openrouter_api_key.get_secret_value() == KEY
    registry = create_registry(Settings(_env_file=None))
    assert isinstance(registry.get(), UnavailableProvider)
    assert isinstance(registry.get('openai'), OpenAIProvider)
    assert isinstance(registry.get('openrouter'), OpenRouterProvider)


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [False, True])
async def test_executor_with_openrouter_preserves_audit_and_sanitization(client, failure):
    await client.post('/api/agents', json={'name': 'Router worker', 'job_type': 'backend engineer'})
    task = (await client.post('/api/tasks', json={'title': 'Safe text', 'job_type': 'backend engineer'})).json()
    approval = (await client.post('/api/approval-requests', json={
        'action': 'execute_task', 'target_type': 'task', 'target_id': task['id']})).json()
    await client.post(f"/api/approval-requests/{approval['id']}/approve")
    app.dependency_overrides[get_execution_provider] = lambda: create_registry(settings()).get()
    mock, transport = mocked_http(response(401, {'error': {'message': KEY}}) if failure else response())
    with mock as constructor:
        constructor.return_value.__aenter__.return_value = transport
        result = await client.post(f"/api/tasks/{task['id']}/execute", json={'approval_id': approval['id']})
    assert result.status_code == 200
    data = (await client.get(f"/api/tasks/{task['id']}")).json()
    assert data['status'] == ('failed' if failure else 'completed')
    assert data['result'] == (None if failure else 'Safe answer')
    audit = (await client.get('/api/audit-events')).json()
    assert KEY not in str(data) + str(audit)
    assert any(e['action'] == f"task_execution_{data['status']}" for e in audit['items'])
    transport.post.assert_awaited_once()
