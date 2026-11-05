"""Additive Image Studio storage. Binary contents never enter SQLite."""

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from luma_core.db.session import Base


class ImageJob(Base):
    __tablename__ = "image_jobs"
    __table_args__ = (UniqueConstraint("conversation_id", "client_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id"), index=True
    )
    client_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    provider_active: Mapped[bool] = mapped_column(Boolean, default=True)
    model: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[str] = mapped_column(String(32))
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage: Mapped[str] = mapped_column(Text, default="{}")


class ImageAsset(Base):
    __tablename__ = "image_assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("image_assets.id"), nullable=True
    )
    source_attachment_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_attachments.id"), nullable=True
    )
    job_id: Mapped[str | None] = mapped_column(
        ForeignKey("image_jobs.id"), nullable=True
    )
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversation_messages.id"), nullable=True
    )
    mime: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[str] = mapped_column(String(32))
