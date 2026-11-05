"""Standalone browser-test server only. Never used by the production app entrypoint."""
import asyncio
import json
import os

import uvicorn
from luma_core.app import app
from luma_core.agents.executor import get_execution_provider
from luma_core.providers.base import ProviderResponse


class FakeProvider:
    is_available = True

    async def chat(self, prompt):
        content = json.loads(prompt.user_content)
        instruction = content['primary_instruction']
        if instruction == 'SLOW':
            await asyncio.sleep(4)
            return ProviderResponse('Late answer must be discarded')
        if instruction == 'HTML_PAYLOAD':
            return ProviderResponse('<img src=x onerror="window.__xss=true">')
        if instruction.startswith('Remember'):
            return ProviderResponse('ACK')
        if 'project' in instruction.lower():
            return ProviderResponse('Aurora' if 'Aurora' in str(content.get('conversation_history')) else 'UNKNOWN')
        return ProviderResponse('Test answer')


if __name__ == '__main__':
    # Only this explicitly launched test process installs the mock dependency.
    app.dependency_overrides[get_execution_provider] = FakeProvider
    from luma_core.routers import chat
    class DirectFake:
        is_available = True
        async def chat(self, prompt, **kwargs):
            return ProviderResponse('Aurora' if 'Aurora' in str(prompt.messages) else 'Direct answer')
    class Registry:
        def get(self): return DirectFake()
    chat.create_registry = lambda settings: Registry()
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['LUMA_UI_TEST_PORT']), access_log=False)
