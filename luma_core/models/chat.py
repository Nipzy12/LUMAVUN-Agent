"""Additive chat-only records. No changes to legacy task tables."""
from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from luma_core.db.session import Base


class ChatRequest(Base):
    __tablename__ = 'chat_requests'
    __table_args__ = (UniqueConstraint('conversation_id', 'client_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey('conversations.id'), index=True)
    client_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))


class ChatAttachment(Base):
    __tablename__ = 'chat_attachments'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(128))
    text: Mapped[str] = mapped_column(Text, default='')
    conversation_id: Mapped[str | None] = mapped_column(ForeignKey('conversations.id'), nullable=True)


class AttachmentRetention(Base):
    """Additive timestamps, including a conservative grace period for older uploads."""
    __tablename__ = 'chat_attachment_retention'
    attachment_id: Mapped[str] = mapped_column(ForeignKey('chat_attachments.id'), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(32))
