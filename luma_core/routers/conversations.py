"""Authenticated, owner-isolated conversations. Posting never executes AI."""
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.auth import get_owner_identity
from luma_core.config import get_settings
from luma_core.db.session import get_db
from luma_core.models import Conversation, ConversationMessage, Task, TaskStatus
from luma_core.agents.registry import get_task_service
from luma_core.memory.conversations import now
from luma_core.providers.prompts import redact_secrets

router = APIRouter(prefix='/api/conversations', tags=['conversations'])


class ConversationInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(default='New conversation', min_length=1, max_length=255)

    @field_validator('title')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Title must not be blank')
        return value


class ConversationRename(ConversationInput):
    title: str = Field(min_length=1, max_length=255)


class UserMessageInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_message_id: UUID
    content: str = Field(min_length=1, max_length=512)
    job_type: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator('content', 'job_type')
    @classmethod
    def nonblank(cls, value):
        if value is not None and not value.strip():
            raise ValueError('Message and job type must not be blank')
        return value


def serialize_conversation(row):
    return {'id': row.id, 'title': row.title, 'created_at': row.created_at, 'updated_at': row.updated_at}


def serialize_message(row):
    return {'id': row.id, 'conversation_id': row.conversation_id, 'role': row.role,
            'content': row.content, 'created_at': row.created_at, 'task_id': row.task_id,
            'client_message_id': row.client_message_id}


async def owned(session, conversation_id, owner):
    row = await session.scalar(select(Conversation).where(
        Conversation.id == str(conversation_id), Conversation.owner_identity == owner))
    if row is None:
        raise HTTPException(404, 'Conversation not found')
    return row


@router.post('', status_code=201)
async def create_conversation(payload: ConversationInput, owner: str = Depends(get_owner_identity),
                              session: AsyncSession = Depends(get_db)):
    timestamp = now()
    row = Conversation(id=str(uuid4()), owner_identity=owner,
                       title=redact_secrets(payload.title, get_settings()),
                       created_at=timestamp, updated_at=timestamp)
    session.add(row)
    await session.flush()
    return serialize_conversation(row)


@router.get('')
async def list_conversations(owner: str = Depends(get_owner_identity), session: AsyncSession = Depends(get_db),
                             limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    rows = (await session.scalars(select(Conversation).where(Conversation.owner_identity == owner)
            .order_by(Conversation.updated_at.desc(), Conversation.id).offset(offset).limit(limit))).all()
    return {'items': [serialize_conversation(row) for row in rows]}


@router.get('/{conversation_id}')
async def get_conversation(conversation_id: UUID, owner: str = Depends(get_owner_identity),
                           session: AsyncSession = Depends(get_db),
                           after_id: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200)):
    row = await owned(session, conversation_id, owner)
    messages = (await session.scalars(select(ConversationMessage).where(
        ConversationMessage.conversation_id == row.id, ConversationMessage.id > after_id
    ).order_by(ConversationMessage.id).limit(limit + 1))).all()
    page = messages[:limit]
    return {**serialize_conversation(row), 'messages': [serialize_message(m) for m in page],
            'has_more': len(messages) > limit, 'next_after_id': page[-1].id if page else after_id}


@router.patch('/{conversation_id}')
async def rename_conversation(conversation_id: UUID, payload: ConversationRename,
                              owner: str = Depends(get_owner_identity), session: AsyncSession = Depends(get_db)):
    changed = await session.execute(update(Conversation).where(
        Conversation.id == str(conversation_id), Conversation.owner_identity == owner
    ).values(title=redact_secrets(payload.title, get_settings()), updated_at=now()))
    if changed.rowcount != 1:
        raise HTTPException(404, 'Conversation not found')
    return serialize_conversation(await owned(session, conversation_id, owner))


@router.post('/{conversation_id}/messages', status_code=201)
async def add_user_message(conversation_id: UUID, payload: UserMessageInput,
                           owner: str = Depends(get_owner_identity), session: AsyncSession = Depends(get_db)):
    # Acquire the SQLite writer lock before checking idempotency or active turns.
    changed = await session.execute(update(Conversation).where(
        Conversation.id == str(conversation_id), Conversation.owner_identity == owner
    ).values(updated_at=now()))
    if changed.rowcount != 1:
        raise HTTPException(404, 'Conversation not found')
    content = redact_secrets(payload.content, get_settings())
    job_type = redact_secrets(payload.job_type, get_settings()) if payload.job_type else None
    existing = await session.scalar(select(ConversationMessage).where(
        ConversationMessage.conversation_id == str(conversation_id),
        ConversationMessage.client_message_id == str(payload.client_message_id)))
    from luma_core.routers.tasks import _serialize_task
    if existing:
        task = await session.get(Task, existing.task_id)
        if task is None:
            raise HTTPException(409, 'The linked task is no longer available; inspect the conversation before retrying')
        if existing.content != content or task.job_type != job_type:
            raise HTTPException(409, 'Client message ID already used for a different message')
        return {'message': serialize_message(existing), 'task': _serialize_task(task), 'replayed': True}
    active = await session.scalar(select(Task.id).join(ConversationMessage, ConversationMessage.task_id == Task.id).where(
        ConversationMessage.conversation_id == str(conversation_id), ConversationMessage.role == 'user',
        Task.status.in_([TaskStatus.pending, TaskStatus.assigned, TaskStatus.in_progress])).limit(1))
    if active:
        raise HTTPException(409, 'Finish or cancel the active task before adding another turn')
    timestamp = now()
    task = Task(title=content, job_type=job_type, status=TaskStatus.pending,
                created_at=timestamp, updated_at=timestamp)
    session.add(task)
    await session.flush()
    if task.job_type:
        await get_task_service().assign_task(session=session, task=task, assigned_by_id=None)
    message = ConversationMessage(conversation_id=str(conversation_id), role='user', content=content,
                                  created_at=timestamp, task_id=task.id, client_message_id=str(payload.client_message_id))
    session.add(message)
    await session.flush()
    await session.refresh(task)
    return {'message': serialize_message(message), 'task': _serialize_task(task), 'replayed': False}
