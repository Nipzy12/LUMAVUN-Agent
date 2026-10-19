import enum

from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from luma_core.db.session import Base


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"
    cancelled = "cancelled"


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[str] = mapped_column(String(32), nullable=False)
    updated_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[ApprovalStatus] = mapped_column(
        default=ApprovalStatus.pending,
    )
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id", ondelete="set null"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    target_id: Mapped[int | None] = mapped_column(nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    actor: Mapped["Agent | None"] = relationship(
        lazy="selectin",
        foreign_keys=[actor_id],
    )
