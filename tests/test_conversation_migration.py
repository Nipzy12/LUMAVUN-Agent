"""Additive migration and process-restart verification on disposable SQLite."""
import asyncio
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from luma_core.db.session import Base
from luma_core.db.migrate import create_tables
from luma_core.models import (Agent, AgentType, AgentStatus, Department, DepartmentStatus,
    Task, TaskStatus, ApprovalRequest, ApprovalStatus, AuditEvent, AssignmentHistory,
    Conversation, ConversationMessage)


@pytest.mark.asyncio
async def test_additive_migration_preserves_all_legacy_rows_and_restart(tmp_path):
    path = tmp_path / 'legacy.db'
    engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
    legacy = [t for t in Base.metadata.sorted_tables if t.name not in {'conversations', 'conversation_messages', 'chat_requests', 'chat_attachments', 'chat_attachment_retention'}]
    async with engine.begin() as connection:
        await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=legacy))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    timestamp = '2026-01-01T00:00:00+00:00'
    async with sessions() as session:
        department = Department(name='Legacy', status=DepartmentStatus.active, created_at=timestamp)
        session.add(department)
        await session.flush()
        worker = Agent(name='Existing worker', agent_type=AgentType.worker, status=AgentStatus.idle,
                       department_id=department.id, created_at=timestamp)
        session.add(worker)
        await session.flush()
        task = Task(title='Existing task', status=TaskStatus.completed, result='Existing result',
                    agent_id=worker.id, created_at=timestamp)
        session.add(task)
        await session.flush()
        session.add_all([
            ApprovalRequest(action='execute_task', target_type='task', target_id=task.id,
                            status=ApprovalStatus.approved, created_at=timestamp),
            AssignmentHistory(task_id=task.id, action='assigned', assigned_to_id=worker.id, occurred_at=timestamp),
            AuditEvent(action='legacy_event', occurred_at=timestamp, actor='local-owner'),
        ])
        await session.commit()
    def snapshot():
        with sqlite3.connect(path) as conn:
            rows = {t.name: conn.execute(f'SELECT * FROM "{t.name}" ORDER BY rowid').fetchall() for t in legacy}
            schema = conn.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
            schema = [r for r in schema if r[2] not in {'conversations', 'conversation_messages', 'chat_requests', 'chat_attachments', 'chat_attachment_retention'}]
            return schema, rows
    before = snapshot()
    assert all(before[1].values()), 'Every legacy table must contain a representative row'
    with patch('luma_core.db.migrate.engine', engine):
        await create_tables()
        await create_tables()
    assert snapshot() == before
    async with sessions() as session:
        session.add(Conversation(id='f0b1f50a-c26d-4288-a421-28166e54b210', owner_identity='local-owner',
                                 title='Restart test', created_at=timestamp, updated_at=timestamp))
        await session.flush()
        session.add_all([
            ConversationMessage(conversation_id='f0b1f50a-c26d-4288-a421-28166e54b210', role='user',
                                content='Remember Aurora', created_at=timestamp, task_id=task.id),
            ConversationMessage(conversation_id='f0b1f50a-c26d-4288-a421-28166e54b210', role='assistant',
                                content='Aurora remembered', created_at=timestamp, task_id=task.id),
        ])
        await session.commit()
    await engine.dispose()
    # A new Python process performs normal app startup and authenticated API reads.
    program = '''
import asyncio, json, httpx
from luma_core.app import app
async def run():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                    headers={'X-Luma-Owner-Token':'restart-test-token'}) as client:
            response = await client.get('/api/conversations/f0b1f50a-c26d-4288-a421-28166e54b210')
            assert response.status_code == 200
            print(json.dumps(response.json()))
asyncio.run(run())
'''
    env = dict(os.environ, DATABASE_URL=f'sqlite:///{path}', LOCAL_OWNER_TOKEN='restart-test-token',
               LOCAL_OWNER_ID='local-owner', APP_DEBUG='false')
    result = await asyncio.to_thread(subprocess.run, [sys.executable, '-c', program],
                                    env=env, cwd=Path(__file__).resolve().parents[1],
                                    capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert [m['content'] for m in data['messages']] == ['Remember Aurora', 'Aurora remembered']
    assert snapshot() == before
