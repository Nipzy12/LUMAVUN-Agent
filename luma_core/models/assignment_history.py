import enum

from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from luma_core.db.session import Base


class AssignmentAction(str, enum.Enum):
    assigned = "assigned"
    reassigned = "reassigned"
    unassigned = "unassigned"


class AssignmentHistory(Base):
    __tablename__ = "assignment_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="cascade"),
        nullable=False,
    )
    occurred_at: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    assigned_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id", ondelete="set null"),
        nullable=True,
    )
    assigned_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id", ondelete="set null"),
        nullable=True,
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    task: Mapped["Task"] = relationship(
        lazy="selectin",
        back_populates="assignment_history",
    )
    assigned_by: Mapped["Agent | None"] = relationship(
        lazy="selectin",
        foreign_keys=[assigned_by_id],
    )
    assigned_to: Mapped["Agent | None"] = relationship(
        lazy="selectin",
        foreign_keys=[assigned_to_id],
    )
