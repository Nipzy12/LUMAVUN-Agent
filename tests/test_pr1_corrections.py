"""Regression checks for PR #1 metadata, retention and bounded parsers."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
import os

import httpx
import pytest
from sqlalchemy import select

from luma_core.config import Settings
from luma_core.models import ChatAttachment, AttachmentRetention
from luma_core.providers.registry import create_registry
from luma_core.routers import chat
from luma_core.memory import attachments


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['openai', 'openrouter'])
@pytest.mark.parametrize('level', ['low', 'medium', 'high'])
async def test_response_model_matches_selected_preset(provider, level):
    selected = f'{provider}-{level}-model'
    settings = Settings(_env_file=None, ai_provider=provider, openai_api_key='fake', openrouter_api_key='fake',
                        **{f'{provider}_chat_{level}_model': selected})
    original = httpx.AsyncClient
    def handler(request):
        import json
        assert json.loads(request.content)['model'] == selected
        return httpx.Response(200, json={'choices':[{'message':{'content':'OK'}}]})
    with patch('httpx.AsyncClient',side_effect=lambda **kw:original(transport=httpx.MockTransport(handler),**kw)):
        result = await create_registry(settings).get().chat('hello',model=getattr(settings,f'{provider}_chat_{level}_model'))
    assert result.model == selected


@pytest.fixture
def retention(tmp_path):
    settings = Settings(_env_file=None, chat_attachment_dir=str(tmp_path), chat_attachment_ttl_hours=24)
    with patch.object(chat,'get_settings',return_value=settings):
        yield settings


@pytest.mark.asyncio
async def test_cleanup_expiry_references_orphans_and_legacy_grace(client, retention):
    from luma_core.db import session as db
    cid = (await client.post('/api/conversations',json={})).json()['id']
    root = Path(retention.chat_attachment_dir)
    old = (datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
    recent = datetime.now(timezone.utc).isoformat()
    keys = {name:str(uuid4()) for name in ['linked','expired','recent','legacy','other','orphan','fresh_orphan','symlink']}
    async with db.async_session_factory() as session:
        for name in ['linked','expired','recent','legacy','other']:
            key = keys[name]
            session.add(ChatAttachment(id=key,owner='another-owner' if name=='other' else 'local-owner',
                        name=name,kind='image/png',text='',conversation_id=cid if name=='linked' else None))
            if name != 'legacy':
                session.add(AttachmentRetention(attachment_id=key,created_at=recent if name=='recent' else old))
        await session.commit()
    for name,key in keys.items():
        if name=='symlink': continue
        path = root/key; path.write_bytes(b'private bytes')
        if name != 'fresh_orphan': os.utime(path,(1,1))
    (root/'unrelated.txt').write_text('keep')
    outside = root/'outside'; outside.write_text('keep')
    try:
        (root/keys['symlink']).symlink_to(outside)
    except OSError:
        pass
    response = await client.post('/api/chat/attachments/cleanup')
    assert response.status_code == 200
    assert response.json() == {'expired_attachments_removed':1,'orphan_files_removed':1}
    for name in ['linked','recent','legacy','other','fresh_orphan']:
        assert (root/keys[name]).is_file()
    assert outside.read_text()=='keep' and (root/'unrelated.txt').is_file()
    async with db.async_session_factory() as session:
        assert await session.get(ChatAttachment,keys['expired']) is None
        assert await session.get(AttachmentRetention,keys['legacy']) is not None
    assert (await client.post('/api/chat/attachments/cleanup')).json() == {'expired_attachments_removed':0,'orphan_files_removed':0}
    client.headers.clear()
    assert (await client.post('/api/chat/attachments/cleanup')).status_code == 401


@pytest.mark.asyncio
async def test_uploaded_text_expiry_and_linked_retention(client, retention):
    from luma_core.db import session as db
    response = await client.post('/api/chat/attachments',content=b'note',headers={'Content-Type':'text/plain'})
    key = response.json()['id']
    async with db.async_session_factory() as session:
        stamp = await session.get(AttachmentRetention,key)
        assert stamp
        stamp.created_at = (datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
        await session.commit()
    assert (await client.post('/api/chat/attachments/cleanup')).json()['expired_attachments_removed']==1
    assert (await client.get('/api/chat/attachments/'+key)).status_code==404


@pytest.mark.asyncio
async def test_cleanup_failed_unlink_retains_row(client, retention):
    from luma_core.db import session as db
    key=str(uuid4()); (Path(retention.chat_attachment_dir)/key).write_bytes(b'image')
    async with db.async_session_factory() as session:
        session.add(ChatAttachment(id=key,owner='local-owner',name='test',kind='image/png',text=''))
        session.add(AttachmentRetention(attachment_id=key,created_at='2000-01-01T00:00:00+00:00'))
        await session.commit()
    with patch.object(Path,'unlink',side_effect=PermissionError()):
        assert (await client.post('/api/chat/attachments/cleanup')).json()['expired_attachments_removed']==0
    async with db.async_session_factory() as session:
        assert await session.get(ChatAttachment,key)


@pytest.mark.asyncio
async def test_parser_timeout_kills_worker():
    import asyncio
    class Worker:
        returncode=None
        killed=False
        async def communicate(self,data): await asyncio.sleep(1)
        def kill(self): self.killed=True; self.returncode=-9
        async def wait(self): return -9
    worker=Worker()
    with patch.object(attachments,'PARSER_TIMEOUT',.01), patch('asyncio.create_subprocess_exec',return_value=worker):
        with pytest.raises(TimeoutError): await attachments.parse_attachment(b'pdf','application/pdf')
    assert worker.killed


@pytest.mark.asyncio
async def test_large_and_truncated_images_rejected(client, retention):
    from PIL import Image
    output=BytesIO(); Image.new('1',(4001,4000)).save(output,format='PNG')
    assert (await client.post('/api/chat/attachments',content=output.getvalue(),headers={'Content-Type':'image/png'})).status_code==422
    output=BytesIO(); Image.new('RGB',(10,10)).save(output,format='JPEG')
    assert (await client.post('/api/chat/attachments',content=output.getvalue()[:-40],headers={'Content-Type':'image/jpeg'})).status_code==422


@pytest.mark.asyncio
async def test_pdf_page_and_text_limits(client, retention):
    from pypdf import PdfWriter
    writer=PdfWriter()
    for _ in range(31): writer.add_blank_page(10,10)
    output=BytesIO(); writer.write(output)
    assert (await client.post('/api/chat/attachments',content=output.getvalue(),headers={'Content-Type':'application/pdf'})).status_code==422


@pytest.mark.asyncio
async def test_cleanup_waits_for_concurrent_binding(tmp_path):
    import asyncio
    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from luma_core.db.session import Base
    from luma_core.models import Conversation
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "race.db"}')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    key = str(uuid4()); cid = str(uuid4())
    file = tmp_path/key; file.write_bytes(b'linked image')
    settings = Settings(_env_file=None,chat_attachment_dir=str(tmp_path))
    async with sessions() as session:
        session.add(Conversation(id=cid,owner_identity='local-owner',title='keep',created_at='now',updated_at='now'))
        session.add(ChatAttachment(id=key,owner='local-owner',name='image',kind='image/png',text=''))
        session.add(AttachmentRetention(attachment_id=key,created_at='2000-01-01T00:00:00+00:00'))
        await session.commit()
    async with sessions() as binding, sessions() as cleanup:
        await binding.execute(update(ChatAttachment).where(ChatAttachment.id==key).values(conversation_id=cid))
        future = asyncio.create_task(attachments.cleanup_attachments(cleanup,settings,'local-owner'))
        await asyncio.sleep(.05)
        assert not future.done(), 'Cleanup must wait for the binding transaction'
        await binding.commit()
        assert (await future)['expired_attachments_removed']==0
        await cleanup.commit()
    assert file.read_bytes()==b'linked image'
    await engine.dispose()


@pytest.mark.asyncio
async def test_retention_migration_preserves_phase321_rows(tmp_path):
    import sqlite3
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from luma_core.db.session import Base
    from luma_core.db.migrate import create_tables
    from luma_core.models import Conversation, ChatRequest, ConversationMessage
    path=tmp_path/'phase321.db'
    engine=create_async_engine(f'sqlite+aiosqlite:///{path}')
    previous=[t for t in Base.metadata.sorted_tables if t.name!='chat_attachment_retention']
    async with engine.begin() as connection:
        await connection.run_sync(lambda conn:Base.metadata.create_all(conn,tables=previous))
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    cid=str(uuid4()); key=str(uuid4())
    async with sessions() as session:
        session.add(Conversation(id=cid,owner_identity='local-owner',title='Existing',created_at='before',updated_at='before'))
        session.add(ChatAttachment(id=key,owner='local-owner',name='keep',kind='image/png',text='',conversation_id=cid))
        session.add(ChatRequest(id=str(uuid4()),conversation_id=cid,client_id=str(uuid4()),fingerprint='keep',status='completed'))
        session.add(ConversationMessage(conversation_id=cid,role='assistant',content='Original answer',created_at='before'))
        await session.commit()
    def snapshot():
        with sqlite3.connect(path) as conn:
            schema=conn.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name!='chat_attachment_retention' ORDER BY type,name").fetchall()
            rows={t.name:conn.execute(f'SELECT * FROM "{t.name}" ORDER BY rowid').fetchall() for t in previous}
            return schema,rows
    before=snapshot()
    with patch('luma_core.db.migrate.engine',engine):
        await create_tables(); await create_tables()
    assert snapshot()==before
    async with sessions() as session:
        assert (await session.get(ChatAttachment,key)).conversation_id==cid
        assert (await session.execute(select(AttachmentRetention))).all()==[]
    await engine.dispose()
