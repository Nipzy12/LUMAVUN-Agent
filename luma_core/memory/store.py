from dataclasses import dataclass, field
from typing import Any

from luma_core.governance.policy import GovernancePolicy


@dataclass
class MemoryEntry:
    key: str
    value: Any
    kind: str = "note"
    tags: list[str] = field(default_factory=list)
    created_at: str = ""


class MemoryStore:
    """Future: short-term and long-term memory for agents.

    Phase 1: in-memory placeholder so the layer exists from day one.
    """

    def __init__(self, policy: GovernancePolicy | None = None) -> None:
        self._policy = policy or GovernancePolicy()
        self._entries: dict[str, MemoryEntry] = {}

    def put(self, entry: MemoryEntry) -> None:
        self._entries[entry.key] = entry

    def get(self, key: str) -> MemoryEntry | None:
        return self._entries.get(key)

    def list_by_tag(self, tag: str) -> list[MemoryEntry]:
        return [e for e in self._entries.values() if tag in e.tags]

    def remove(self, key: str) -> bool:
        return self._entries.pop(key, None) is not None
