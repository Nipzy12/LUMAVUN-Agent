import pytest

from luma_core.agents.job_type_registry import DEFAULT_JOB_TYPE_MAPPINGS, JobTypeRegistry
from luma_core.agents.service import AgentService
from luma_core.models import (
    Agent,
    AgentStatus,
    AgentType,
    AutonomyLevel,
    Department,
    DepartmentStatus,
    TaskStatus,
)
from luma_core.providers.base import UnavailableProvider


def test_default_autonomy_is_supervised() -> None:
    service = AgentService()
    assert service.DEFAULT_AUTONOMY == AutonomyLevel.supervised


def test_autonomy_normalization_defaults_to_supervised() -> None:
    service = AgentService()
    assert service.normalize_autonomy(None) == AutonomyLevel.supervised
    assert service.normalize_autonomy("not-a-real-level") == AutonomyLevel.supervised


def test_autonomy_normalization_accepts_valid_value() -> None:
    service = AgentService()
    assert service.normalize_autonomy("autonomous") == AutonomyLevel.autonomous
    assert service.normalize_autonomy(AutonomyLevel.assisted) == AutonomyLevel.assisted


def test_default_manager_is_supervised() -> None:
    registry = JobTypeRegistry()
    assert registry.default_manager_autonomy() == AutonomyLevel.supervised
    assert registry.default_manager_type() == AgentType.manager


def test_job_type_registry_resolves_known_types() -> None:
    registry = JobTypeRegistry()
    assert registry.resolve("web developer") is not None
    assert registry.department_name_for("web developer") == "Development"
    role, skills = registry.manager_spec_for("web developer")
    assert role == "Dev Manager"
    assert "engineering" in skills


def test_job_type_registry_falls_back_for_unknown_types() -> None:
    registry = JobTypeRegistry()
    assert registry.resolve("moon rock analyst") is None
    assert registry.department_name_for("moon rock analyst") == "Moon Rock Analyst Team"
    assert registry.manager_spec_for("moon rock analyst") is None


def test_agent_skills_json_round_trip() -> None:
    agent = Agent(name="test", skills=None)  # type: ignore[arg-type]
    agent.set_skills(["video", "editing"])
    assert agent.get_skills() == ["video", "editing"]


def test_agent_skills_empty_by_default() -> None:
    agent = Agent(name="test", skills=None)  # type: ignore[arg-type]
    assert agent.get_skills() == []


def test_unavailable_provider_is_not_available() -> None:
    provider = UnavailableProvider(settings=None)  # type: ignore[arg-type]
    assert provider.is_available is False


def test_department_status_enum_values() -> None:
    assert DepartmentStatus.active.value == "active"
    assert DepartmentStatus.archived.value == "archived"


def test_task_status_enum_values() -> None:
    assert TaskStatus.pending.value == "pending"
    assert TaskStatus.completed.value == "completed"


def test_agent_type_enum_values() -> None:
    assert AgentType.worker.value == "worker"
    assert AgentType.manager.value == "manager"
