"""Additive advanced/private Studio metadata; existing media rows remain immutable."""

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from luma_core.db.session import Base


class StudioWorkspace(Base):
    __tablename__ = "studio_workspaces"
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id"), primary_key=True
    )
    owner: Mapped[str] = mapped_column(String(128), index=True)
    private: Mapped[bool] = mapped_column(Boolean, default=False)
    gallery_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class StudioUnlock(Base):
    __tablename__ = "studio_unlocks"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    expires_at: Mapped[str] = mapped_column(String(32))


class StudioAttachment(Base):
    __tablename__ = "studio_attachments"
    attachment_id: Mapped[str] = mapped_column(
        ForeignKey("chat_attachments.id"), primary_key=True
    )
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("studio_workspaces.conversation_id"), index=True
    )


class StudioExecution(Base):
    __tablename__ = "studio_executions"
    job_id: Mapped[str] = mapped_column(ForeignKey("image_jobs.id"), primary_key=True)
    engine: Mapped[str] = mapped_column(String(32))
    remote_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stage: Mapped[str] = mapped_column(String(32), default="prepared")
    progress: Mapped[int] = mapped_column(default=0)
    mask_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_attachments.id"), nullable=True
    )
    recipe: Mapped[str] = mapped_column(String(32))
    parameters: Mapped[str] = mapped_column(Text, default="{}")


class LoraPreset(Base):
    __tablename__ = "studio_lora_presets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(80))
    private: Mapped[bool] = mapped_column(Boolean, default=False)
    family: Mapped[str] = mapped_column(String(16))
    selections: Mapped[str] = mapped_column(Text)


class StudioPreference(Base):
    __tablename__ = "studio_preferences"
    owner: Mapped[str] = mapped_column(String(128), primary_key=True)
    private: Mapped[bool] = mapped_column(Boolean, primary_key=True)
    engine: Mapped[str] = mapped_column(String(32))
    default_model: Mapped[str] = mapped_column(String(128))
