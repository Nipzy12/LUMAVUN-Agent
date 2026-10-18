import pytest

from luma_core.agents.service import AgentService
from luma_core.models import AutonomyLevel, DepartmentStatus, TaskStatus
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


def test_unavailable_provider_is_not_available() -> None:
    provider = UnavailableProvider(settings=None)  # type: ignore[arg-type]
    assert provider.is_available is False


def test_department_status_enum_values() -> None:
    assert DepartmentStatus.active.value == "active"
    assert DepartmentStatus.archived.value == "archived"


def test_task_status_enum_values() -> None:
    assert TaskStatus.pending.value == "pending"
    assert TaskStatus.completed.value == "completed"
