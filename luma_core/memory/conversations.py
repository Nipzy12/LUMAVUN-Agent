"""Private conversation access, bounded history, and atomic completion storage."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, exists, or_, select, update, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from luma_core.models import Conversation, ConversationMessage, Task, TaskStatus, ApprovalRequest
from luma_core.config import Settings
from luma_core.providers.prompts import redact_secrets


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def task_visibility(task_id, owner: str | None):
    linked = exists(select(ConversationMessage.id).where(
        ConversationMessage.task_id == task_id, ConversationMessage.role == 'user'))
    owned = exists(select(ConversationMessage.id).join(
        Conversation, Conversation.id == ConversationMessage.conversation_id).where(
        ConversationMessage.task_id == task_id, ConversationMessage.role == 'user',
        Conversation.owner_identity == owner)) if owner is not None else False
    return or_(~linked, owned)


def approval_visibility(target_type, target_id, owner):
    conversation_owned = exists(select(Conversation.id).where(
        Conversation.id == target_id, Conversation.owner_identity == owner)) if owner else False
    return and_(or_(target_type.is_(None), target_type != 'task', task_visibility(target_id, owner)),
                or_(target_type.is_(None), target_type != 'conversation', conversation_owned))


def audit_visibility(event, owner):
    from luma_core.models import ImageJob
    from luma_core.memory.studio_privacy import public_conversation
    image_owned = exists(select(ImageJob.id).where(
        ImageJob.id == func.json_extract(case((func.json_valid(event.metadata_), event.metadata_), else_='{}'), '$.job_id'), ImageJob.owner == owner, public_conversation(ImageJob.conversation_id))) if owner else False
    approval_owned = exists(select(ApprovalRequest.id).where(
        ApprovalRequest.id == event.target_id,
        approval_visibility(ApprovalRequest.target_type, ApprovalRequest.target_id, owner)))
    return and_(or_(event.target_type.is_(None), event.target_type != 'image_job', image_owned),
                approval_visibility(event.target_type, event.target_id, owner),
                or_(event.target_type.is_(None), event.target_type != 'approval_request', approval_owned))


async def require_task_access(session: AsyncSession, task_id: int, owner: str | None):
    # Nonexistent legacy targets retain their existing endpoint error semantics.
    visible = await session.scalar(select(task_visibility(task_id, owner)))
    if not visible:
        raise HTTPException(404, 'Task not found')


async def linked_user_message(session: AsyncSession, task_id: int):
    return await session.scalar(select(ConversationMessage).where(
        ConversationMessage.task_id == task_id, ConversationMessage.role == 'user'))


async def require_latest_turn(session: AsyncSession, task_id: int):
    message = await linked_user_message(session, task_id)
    if message is None:
        return
    latest = await session.scalar(select(ConversationMessage.id).where(
        ConversationMessage.conversation_id == message.conversation_id,
        ConversationMessage.role == 'user').order_by(ConversationMessage.id.desc()).limit(1))
    if latest != message.id:
        raise HTTPException(409, 'Only the latest conversation turn may be executed or retried')


async def history_for_task(session: AsyncSession, task_id: int, settings: Settings) -> tuple[list[dict], bool]:
    current = await linked_user_message(session, task_id)
    if current is None or not settings.conversation_context_max_messages or not settings.conversation_context_max_chars:
        return [], False
    limit = settings.conversation_context_max_messages
    rows = list((await session.scalars(select(ConversationMessage).join(Task, Task.id == ConversationMessage.task_id).where(
        ConversationMessage.conversation_id == current.conversation_id,
        ConversationMessage.id < current.id, Task.status == TaskStatus.completed,
    ).order_by(ConversationMessage.id.desc()).limit(limit + 1))).all())
    truncated = len(rows) > limit
    remaining = settings.conversation_context_max_chars
    selected = []
    for row in rows[:limit]:
        content = redact_secrets(row.content, settings)
        if not remaining:
            truncated = True
            break
        if len(content) > remaining:
            content = content[:remaining]
            truncated = True
        selected.append({'role': row.role, 'content': content})
        remaining -= len(content)
    selected.reverse()
    return selected, truncated


async def save_assistant_message(session: AsyncSession, task_id: int, content: str):
    """Called only after a successful conditional completion, in the same transaction."""
    user = await linked_user_message(session, task_id)
    if user is None:
        return
    existing = await session.scalar(select(ConversationMessage.id).where(
        ConversationMessage.task_id == task_id, ConversationMessage.role == 'assistant'))
    if existing is None:
        session.add(ConversationMessage(conversation_id=user.conversation_id, task_id=task_id,
                    role='assistant', content=content, created_at=now()))
    await session.execute(update(Conversation).where(Conversation.id == user.conversation_id).values(updated_at=now()))
