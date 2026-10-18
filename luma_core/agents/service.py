from luma_core.models import Agent, AutonomyLevel


class AgentService:
    """Agent domain logic kept separate from HTTP and persistence.

    Phase 1 keeps this thin. Future phases add:
    - default autonomy enforcement
    - supervisor approval gates
    - per-agent model provider routing
    """

    DEFAULT_AUTONOMY = AutonomyLevel.supervised

    def normalize_autonomy(self, level: AutonomyLevel | str | None) -> AutonomyLevel:
        if level is None:
            return self.DEFAULT_AUTONOMY
        if isinstance(level, AutonomyLevel):
            return level
        try:
            return AutonomyLevel(level)
        except ValueError:
            return self.DEFAULT_AUTONOMY

    def is_action_allowed_without_approval(self, agent: Agent) -> bool:
        # Phase 1: only fully autonomous agents act without a supervisor gate.
        return agent.autonomy_level == AutonomyLevel.autonomous
