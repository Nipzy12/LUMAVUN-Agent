import enum

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from luma_core.db.session import Base


class AuditAction(str, enum.Enum):
    agent_created = "agent_created"
    manager_assigned = "manager_assigned"
    task_created = "task_created"
    task_assigned = "task_assigned"
    task_unassigned = "task_unassigned"
    approval_requested = "approval_requested"
    approval_granted = "approval_granted"
    approval_denied = "approval_denied"
    policy_denied = "policy_denied"
    sensitive_action_attempted = "sensitive_action_attempted"


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    target_id: Mapped[int | None] = mapped_column(nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[str | None] = mapped_column(Text, nullable=True)
