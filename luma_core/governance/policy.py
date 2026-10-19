from dataclasses import dataclass, field
from typing import Iterable

from luma_core.models import AuditAction, AuditEvent


@dataclass
class GovernancePolicy:
    """Phase 2 policy engine.

    - Explicit allow/deny decisions per action type.
    - Execution-boundary permission checks.
    - Approval request creation for sensitive actions.
    - Append-only audit events.
    """

    require_approval_for_autonomous_actions: bool = True
    sensitive_action_types: set[str] = field(
        default_factory=lambda: {"execute_task", "publish_result", "transfer_funds"}
    )
    allowed_actions: frozenset[str] = field(
        default_factory=lambda: frozenset({
            "view_department",
            "list_agents",
            "list_tasks",
            "create_task",
            "assign_task",
            "read_audit_events",
            "read_approval_requests",
        })
    )

    def allow(self, action: str, actor: str | None = None) -> bool:
        return action in self.allowed_actions

    def deny(self, action: str, actor: str | None = None) -> bool:
        return action not in self.allowed_actions

    def requires_approval(self, action: str) -> bool:
        return action in self.sensitive_action_types

    def record_audit(
        self,
        session,
        action: AuditAction,
        actor: str | None = None,
        target_type: str | None = None,
        target_id: int | None = None,
        summary: str | None = None,
        metadata_: dict | None = None,
    ) -> AuditEvent:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        event = AuditEvent(
            occurred_at=now,
            action=action.value if isinstance(action, AuditAction) else action,
            actor=actor,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            metadata_=metadata_,
        )
        session.add(event)
        return event
