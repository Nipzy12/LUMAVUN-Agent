"""Private access is a route capability, never granted to ordinary APIs by headers."""

from contextvars import ContextVar
from fastapi import HTTPException
from sqlalchemy import exists, select
from luma_core.models.studio import StudioWorkspace, StudioAttachment

private_owner = ContextVar("studio_private_owner", default=None)


def public_conversation(conversation_id):
    return ~exists(
        select(StudioWorkspace.conversation_id).where(
            StudioWorkspace.conversation_id == conversation_id,
            StudioWorkspace.private.is_(True),
        )
    )


async def guard_conversation(session, conversation_id, owner):
    scope = await session.scalar(
        select(StudioWorkspace)
        .where(StudioWorkspace.conversation_id == str(conversation_id))
        .execution_options(populate_existing=True)
    )
    if scope and (
        scope.deleted
        or scope.owner != owner
        or (scope.private and private_owner.get() != owner)
    ):
        raise HTTPException(404, "Conversation not found")


async def guard_attachment(session, attachment_id, owner):
    scope = await session.get(StudioAttachment, str(attachment_id))
    if scope:
        await guard_conversation(session, scope.conversation_id, owner)
