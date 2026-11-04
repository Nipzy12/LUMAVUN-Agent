from unittest.mock import patch
from uuid import uuid4
from io import BytesIO

import pytest
from luma_core.config import Settings
from luma_core.providers.base import ProviderResponse
from luma_core.routers import chat


class Fake:
    is_available = True
    calls = []
    async def chat(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        return ProviderResponse('LUMA_CHAT_OK')


@pytest.fixture
def provider(tmp_path):
    settings = Settings(_env_file=None, local_owner_token='test-owner-token-12345', ai_provider='openai',
                        openai_api_key='fake-secret-key', chat_attachment_dir=str(tmp_path), openai_chat_high_model='premium-model')
    fake = Fake(); fake.calls = []
    with patch.object(chat, 'get_settings', return_value=settings), patch.object(chat, 'create_registry') as registry:
        registry.return_value.get.return_value = fake
        yield fake, settings


async def conversation(client):
    return (await client.post('/api/conversations', json={})).json()['id']


async def send(client, cid, **extra):
    return await client.post(f'/api/chat/conversations/{cid}/messages', json={
        'client_message_id':str(uuid4()), 'content':'Reply only LUMA_CHAT_OK', **extra})


@pytest.mark.asyncio
async def test_direct_no_tasks_approval_memory_and_replay(client, provider):
    fake, settings = provider
    cid = await conversation(client)
    key = str(uuid4())
    assert (await send(client, cid, client_message_id=key)).status_code == 200
    assert (await send(client, cid, client_message_id=key)).json()['replayed']
    assert len(fake.calls) == 1
    assert (await send(client, cid, client_message_id=key, content='different')).status_code == 409
    await send(client, cid, content='Follow up')
    messages = fake.calls[-1][0].provider_messages(settings)
    assert [m['role'] for m in messages] == ['system','user','assistant','user']
    assert messages[1]['content'] == 'Reply only LUMA_CHAT_OK'
    detail = (await client.get('/api/conversations/'+cid)).json()
    assert len(detail['messages']) == 4
    assert all(m['task_id'] is None for m in detail['messages'])
    assert (await client.get('/api/tasks')).json()['items'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('level,tokens,model', [('low',256,'gpt-4o-mini'),('medium',1024,'gpt-4o-mini'),('high',2048,'premium-model')])
async def test_levels(client, provider, level, tokens, model):
    fake, _ = provider
    assert (await send(client, await conversation(client), level=level)).status_code == 200
    assert fake.calls[0][1] == {'model':model, 'max_tokens':tokens}


@pytest.mark.asyncio
@pytest.mark.parametrize('extra', [{'level':'unlimited'},{'endpoint':'https://example.com'},{'content':' '},{'attachments':[str(uuid4())]}])
async def test_invalid_input(client, provider, extra):
    response = await send(client, await conversation(client), **extra)
    assert response.status_code in (404,422)
    assert not provider[0].calls


@pytest.mark.asyncio
async def test_auth_and_isolation(client, provider):
    cid = await conversation(client)
    client.headers.clear()
    assert (await send(client,cid)).status_code == 401
    client.headers['X-Luma-Owner-Token'] = 'test-owner-token-12345'
    with patch('luma_core.auth.get_settings', return_value=Settings(_env_file=None, local_owner_token='test-owner-token-12345',local_owner_id='other')):
        assert (await send(client,cid)).status_code == 404


@pytest.mark.asyncio
async def test_failure_and_unavailable(client, provider):
    fake,_ = provider
    cid = await conversation(client)
    fake.is_available = False
    assert (await send(client,cid)).status_code == 503
    fake.is_available = True
    async def broken(*a,**kw): raise RuntimeError('fake-secret-key private raw error')
    fake.chat = broken
    result = await send(client,cid)
    assert result.status_code == 502
    assert 'fake-secret-key' not in result.text and 'private raw' not in result.text
    assert len((await client.get('/api/conversations/'+cid)).json()['messages']) == 1


@pytest.mark.asyncio
async def test_bounded_secret_history(client, provider):
    fake,settings = provider
    settings.conversation_context_max_chars = 5
    await send(client, cid := await conversation(client), content='fake-secret-key')
    await send(client,cid)
    messages = fake.calls[-1][0].provider_messages(settings)
    assert len(messages[1]['content']) <= 5
    assert 'fake-secret-key' not in str(messages)
    assert 'fake-secret-key' not in (await client.get('/api/conversations/'+cid)).text


@pytest.mark.asyncio
async def test_work_still_requires_approval(client, provider):
    cid = await conversation(client)
    response = await client.post(f'/api/conversations/{cid}/messages',json={'client_message_id':str(uuid4()),'content':'Work task'})
    assert response.status_code == 201
    task = response.json()['task']
    assert (await client.post(f"/api/tasks/{task['id']}/execute")).status_code != 200
    assert (await send(client,cid)).status_code == 409
    assert not provider[0].calls


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,data,name', [('text/plain',b'hello','note.txt'),('image/png',b'bad','bad.png'),('text/html',b'<script>','bad.html'),('text/plain',b'hello','../bad.txt'),('text/plain',b'\xff','bad.txt'),('application/pdf',b'bad','bad.pdf')])
async def test_upload_validation(client, provider, kind,data,name):
    response = await client.post('/api/chat/attachments',content=data,headers={'Content-Type':kind,'X-File-Name':name})
    assert response.status_code == (201 if name == 'note.txt' else 422)


@pytest.mark.asyncio
async def test_image_capability_and_authenticated_retrieval(client, provider):
    from PIL import Image
    out = BytesIO(); Image.new('RGB',(2,2)).save(out,format='PNG')
    response = await client.post('/api/chat/attachments',content=out.getvalue(),headers={'Content-Type':'image/png','X-File-Name':'test.png'})
    assert response.status_code == 201
    key = response.json()['id']
    cid = await conversation(client)
    assert (await send(client,cid,level='high',attachments=[key])).status_code == 422
    assert (await send(client,cid,attachments=[key])).status_code == 200
    messages = provider[0].calls[0][0].provider_messages(provider[1])
    assert messages[-1]['content'][1]['image_url']['url'].startswith('data:image/png;base64,')
    assert (await client.get('/api/chat/attachments/'+key)).status_code == 200
    client.headers.clear()
    assert (await client.get('/api/chat/attachments/'+key)).status_code == 401


@pytest.mark.asyncio
async def test_inflight_duplicate_and_work_blocked(client, provider):
    fake, _ = provider
    cid = await conversation(client)
    async def pending(prompt, **kwargs):
        assert (await send(client,cid)).status_code == 409
        result = await client.post(f'/api/conversations/{cid}/messages',json={'client_message_id':str(uuid4()),'content':'Work task'})
        assert result.status_code == 409
        return ProviderResponse('done')
    fake.chat = pending
    assert (await send(client,cid)).status_code == 200


@pytest.mark.asyncio
async def test_timeout_controlled(client, provider):
    import asyncio
    fake, settings = provider
    settings.ai_timeout_seconds = .01
    async def slow(*a, **kw):
        await asyncio.sleep(1)
    fake.chat = slow
    assert (await send(client,await conversation(client))).status_code == 502


@pytest.mark.asyncio
async def test_document_context_and_oversize(client, provider):
    assert (await client.post('/api/chat/attachments',content=b'x'*(chat.MAX_FILE+1),headers={'Content-Type':'text/plain'})).status_code == 413
    response = await client.post('/api/chat/attachments',content=b'Note fake-secret-key',headers={'Content-Type':'text/plain','X-File-Name':'note.txt'})
    key = response.json()['id']
    assert 'fake-secret-key' not in response.text
    assert (await send(client,await conversation(client),attachments=[key])).status_code == 200
    assert '[REDACTED]' in str(provider[0].calls[0][0].provider_messages(provider[1]))


@pytest.mark.asyncio
@pytest.mark.parametrize('provider_name', ['openai', 'openrouter'])
async def test_adapter_structured_multimodal(client, provider_name):
    import httpx
    from luma_core.providers.registry import create_registry
    settings = Settings(_env_file=None,ai_provider=provider_name,openai_api_key='fake-key',openrouter_api_key='fake-key')
    prompt = chat.ChatPrompt([{'role':'system','content':'Fixed safety'}, {'role':'user','content':[{'type':'text','text':'Instruction'}]}])
    seen = []
    def handler(request):
        import json
        seen.append(json.loads(request.content))
        return httpx.Response(200,json={'choices':[{'message':{'content':'OK'}}]})
    original = httpx.AsyncClient
    with patch('httpx.AsyncClient', side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw)):
        result = await create_registry(settings).get().chat(prompt,model='chosen',max_tokens=300)
    assert result.text == 'OK'
    assert seen[0]['model'] == 'chosen'
    assert seen[0]['messages'][1]['content'][0]['text'] == 'Instruction'
    assert not any(k in seen[0] for k in ('tools','reasoning_effort'))


@pytest.mark.asyncio
async def test_attachment_owner_isolation_and_document_preview(client, provider):
    response = await client.post('/api/chat/attachments',content=b'private note',headers={'Content-Type':'text/plain','X-File-Name':'note.txt'})
    key = response.json()['id']
    assert (await client.get('/api/chat/attachments/'+key)).json()['text'] == 'private note'
    with patch('luma_core.auth.get_settings',return_value=Settings(_env_file=None,local_owner_token='test-owner-token-12345',local_owner_id='other')):
        assert (await client.get('/api/chat/attachments/'+key)).status_code == 404


@pytest.mark.asyncio
async def test_text_pdf_extraction(client, provider):
    # Generate a minimal text-bearing PDF without any external file or API call.
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer = PdfWriter(); page = writer.add_blank_page(200,200)
    font = DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
    stream = DecodedStreamObject(); stream.set_data(b'BT /F1 12 Tf 10 10 Td (PDF note) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    output = BytesIO(); writer.write(output)
    response = await client.post('/api/chat/attachments',content=output.getvalue(),headers={'Content-Type':'application/pdf','X-File-Name':'note.pdf'})
    assert response.status_code == 201
    assert 'PDF note' in response.json()['preview']


@pytest.mark.asyncio
async def test_validation_never_echoes_secrets(client, provider):
    response = await send(client,await conversation(client), content='fake-secret-key'*100)
    assert response.status_code == 422
    assert 'fake-secret-key' not in response.text
