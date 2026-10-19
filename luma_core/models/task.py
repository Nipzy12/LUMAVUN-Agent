import enum

from sqlalchemy import String, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from luma_core.db.session import Base


class TaskStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id", ondelete="set null"),
        nullable=True,
    )
    agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id", ondelete="set null"),
        nullable=True,
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="set null"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        default=TaskStatus.pending,
    )
    priority: Mapped[int] = mapped_column(default=0)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )
    updated_at: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    agent: Mapped["Agent | None"] = relationship(
        back_populates="tasks",
        lazy="selectin",
        foreign_keys=[agent_id],
    )

    @property
    def assignee_name(self) -> str | None:
        return self.agent.name if self.agent else None

    owner: Mapped["Agent | None"] = relationship(
        "Agent",
        lazy="selectin",
        foreign_keys=[owner_id],
    )

    assignment_history: Mapped[list["AssignmentHistory"]] = relationship(
        back_populates="task",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
