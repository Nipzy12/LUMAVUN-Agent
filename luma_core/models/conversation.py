"""Additive conversation storage; legacy task columns remain unchanged."""
from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from luma_core.db.session import Base


class Conversation(Base):
    __tablename__ = 'conversations'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_identity: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[str] = mapped_column(String(32), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(32), nullable=False)


class ConversationMessage(Base):
    __tablename__ = 'conversation_messages'
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name='ck_conversation_message_role'),
        UniqueConstraint('task_id', 'role', name='uq_conversation_task_role'),
        UniqueConstraint('conversation_id', 'client_message_id', name='uq_conversation_client_message'),
        Index('ix_conversation_message_order', 'conversation_id', 'id'),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey('conversations.id'), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(32), nullable=False)
    task_id: Mapped[int | None] = mapped_column(ForeignKey('tasks.id'), nullable=True, index=True)
    client_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
