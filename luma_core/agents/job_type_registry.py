from dataclasses import dataclass, field
from typing import Iterable

from luma_core.models import AgentType, AutonomyLevel


@dataclass(frozen=True)
class JobTypeMapping:
    job_type: str
    department_name: str
    manager_role: str
    manager_skills: list[str] = field(default_factory=list)


DEFAULT_JOB_TYPE_MAPPINGS: list[JobTypeMapping] = [
    JobTypeMapping(
        job_type="videographer",
        department_name="Media Studio",
        manager_role="Media Manager",
        manager_skills=["video", "media", "production"],
    ),
    JobTypeMapping(
        job_type="video editor",
        department_name="Media Studio",
        manager_role="Media Manager",
        manager_skills=["video", "editing", "media"],
    ),
    JobTypeMapping(
        job_type="web developer",
        department_name="Development",
        manager_role="Dev Manager",
        manager_skills=["web", "development", "engineering"],
    ),
    JobTypeMapping(
        job_type="backend engineer",
        department_name="Development",
        manager_role="Dev Manager",
        manager_skills=["backend", "engineering", "development"],
    ),
    JobTypeMapping(
        job_type="frontend engineer",
        department_name="Development",
        manager_role="Dev Manager",
        manager_skills=["frontend", "engineering", "development"],
    ),
    JobTypeMapping(
        job_type="meme coin researcher",
        department_name="Trading Lab",
        manager_role="Trading Manager",
        manager_skills=["trading", "research", "crypto"],
    ),
    JobTypeMapping(
        job_type="trader",
        department_name="Trading Lab",
        manager_role="Trading Manager",
        manager_skills=["trading", "portfolio", "risk"],
    ),
]


class JobTypeRegistry:
    """Deterministic resolver for department + manager defaults.

    Phase 2 uses this instead of any AI model. Missing job types still create
    a generic department but never invent a manager skills profile.
    """

    def __init__(self, mappings: Iterable[JobTypeMapping] | None = None) -> None:
        self._by_job_type: dict[str, JobTypeMapping] = {}
        for mapping in mappings or DEFAULT_JOB_TYPE_MAPPINGS:
            key = mapping.job_type.lower()
            self._by_job_type[key] = mapping

    def resolve(self, job_type: str) -> JobTypeMapping | None:
        return self._by_job_type.get(job_type.lower() or "")

    def department_name_for(self, job_type: str) -> str:
        mapping = self.resolve(job_type)
        if mapping is not None:
            return mapping.department_name
        return f"{job_type.title()} Team"

    def manager_spec_for(self, job_type: str) -> tuple[str, list[str]] | None:
        mapping = self.resolve(job_type)
        if mapping is None:
            return None
        return (mapping.manager_role, list(mapping.manager_skills))

    def default_manager_autonomy(self) -> AutonomyLevel:
        return AutonomyLevel.supervised

    def default_manager_type(self) -> AgentType:
        return AgentType.manager
