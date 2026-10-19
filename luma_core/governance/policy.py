from dataclasses import dataclass, field
from typing import Iterable

from luma_core.models import AuditAction, AuditEvent, AutonomyLevel


@dataclass
class GovernancePolicy:
    """Phase 2+ policy engine.

    - Default-deny: only explicitly permitted actions pass.
    - Actor identity is required for any mutating or sensitive action.
    - Autonomy limits cap what each autonomy tier may do without approval.
    - Sensitive actions always require an approval request.
    - Every decision is recorded as an append-only audit event.
    """

    # Actions that are always safe for any authenticated actor.
    safe_actions: frozenset[str] = field(
        default_factory=lambda: frozenset({
            "view_department",
            "list_agents",
            "list_tasks",
            "read_audit_events",
            "read_approval_requests",
        })
    )

    # Actions a manager may perform on behalf of their department.
    manager_actions: frozenset[str] = field(
        default_factory=lambda: frozenset({
            "assign_task",
            "create_task",
            "update_task",
        })
    )

    # Actions that only the task owner may perform.
    owner_actions: frozenset[str] = field(
        default_factory=lambda: frozenset({
            "approve_approval_request",
            "deny_approval_request",
            "complete_task",
            "fail_task",
            "cancel_task",
        })
    )

    # Actions that are always sensitive and require explicit approval.
    sensitive_action_types: frozenset[str] = field(
        default_factory=lambda: frozenset({
            "execute_task",
            "publish_result",
            "transfer_funds",
            "run_shell",
        })
    )

    # Autonomy tier -> set of actions that tier may perform without approval.
    # Lower tiers are more restricted.
    autonomy_allowed_actions: dict[AutonomyLevel, frozenset[str]] = field(
        default_factory=lambda: {
            AutonomyLevel.supervised: frozenset(),
            AutonomyLevel.supervised: frozenset({
                "view_department",
                "list_agents",
                "list_tasks",
                "read_audit_events",
                "read_approval_requests",
            }),
            AutonomyLevel.assisted: frozenset({
                "view_department",
                "list_agents",
                "list_tasks",
                "create_task",
                "read_audit_events",
                "read_approval_requests",
            }),
            AutonomyLevel.autonomous: frozenset({
                "view_department",
                "list_agents",
                "list_tasks",
                "create_task",
                "assign_task",
                "read_audit_events",
                "read_approval_requests",
            }),
        }
    )

    def allow(
        self,
        action: str,
        actor: str | None = None,
        agent_autonomy: AutonomyLevel | None = None,
        actor_is_owner: bool = False,
        actor_is_manager: bool = False,
    ) -> bool:
        """Default-deny permission check.

        Returns True only when the action is explicitly allowed for the given
        actor context.
        """
        if action in self.safe_actions:
            return True

        # Owner-only actions require ownership.
        if action in self.owner_actions and actor_is_owner:
            return True

        # Manager actions require manager role.
        if action in self.manager_actions and actor_is_manager:
            return True

        # Autonomy-gated actions: even autonomous agents are limited.
        if agent_autonomy is not None:
            return action in self.autonomy_allowed_actions.get(
                agent_autonomy, frozenset()
            )

        # Default deny.
        return False

    def deny(self, action: str, actor: str | None = None) -> bool:
        """Inverse of ``allow`` for the common case with no actor context."""
        return not self.allow(action, actor=actor)

    def requires_approval(self, action: str) -> bool:
        return action in self.sensitive_action_types

    def can_act_without_approval(
        self,
        agent_autonomy: AutonomyLevel,
        action: str,
    ) -> bool:
        """Whether an agent at the given autonomy tier may perform *action*
        without first obtaining an approval."""
        if action in self.sensitive_action_types:
            return False
        return action in self.autonomy_allowed_actions.get(
            agent_autonomy, frozenset()
        )

    def record_audit(
        self,
        session,
        action: AuditAction | str,
        actor: str | None = None,
        target_type: str | None = None,
        target_id: int | None = None,
        summary: str | None = None,
        metadata_: dict | None = None,
    ) -> AuditEvent:
        import json
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        event = AuditEvent(
            occurred_at=now,
            action=action.value if isinstance(action, AuditAction) else action,
            actor=actor,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            metadata_=json.dumps(metadata_) if metadata_ else None,
        )
        session.add(event)
        return event

    def unauthorized_error(self, action: str) -> HTTPException:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail=f"Action {action!r} is not permitted by policy (default-deny).",
        )
