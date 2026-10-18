from dataclasses import dataclass


@dataclass
class GovernancePolicy:
    """Future: approval thresholds, audit retention, guardrails.

    Phase 1: no-op placeholder so the layer exists from day one.
    """

    require_approval_for_autonomous_actions: bool = True
    audit_retention_days: int = 90

    def approve(self, action: str, actor: str) -> bool:
        # No approval engine in Phase 1.
        return True

    def record_audit(self, action: str, actor: str, outcome: str) -> None:
        pass
