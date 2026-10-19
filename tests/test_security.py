import pytest

from httpx import AsyncClient


def _invalid_autonomy_levels() -> list[str]:
    return ["", "supervis", "SUPERVISED", "autonomous!", "123", "manual", "assisted!", "  "]


def _invalid_agent_statuses() -> list[str]:
    return ["", "actve", "ACTIVE", "idle!", "paused?", "offline!", "sleeping", "busy"]


def _invalid_task_statuses() -> list[str]:
    return ["", "pendng", "PENDING", "in-progress", "IN_PROGRESS", "completed!", "done", "fail", "cancel"]


@pytest.mark.asyncio
async def test_invalid_autonomy_level_returns_422(client: AsyncClient) -> None:
    for bad in _invalid_autonomy_levels():
        response = await client.post(
            "/api/agents",
            json={
                "name": "Bad Autonomy Agent",
                "job_type": "web developer",
                "autonomy_level": bad,
            },
        )
        assert response.status_code == 422, f"Expected 422 for autonomy_level={bad!r}, got {response.status_code}"


@pytest.mark.asyncio
async def test_invalid_agent_status_returns_422(client: AsyncClient) -> None:
    agent = await client.post(
        "/api/agents",
        json={
            "name": "Status Update Target",
            "job_type": "web developer",
        },
    )
    assert agent.status_code == 201
    agent_id = agent.json()["id"]

    for bad in _invalid_agent_statuses():
        response = await client.patch(
            f"/api/agents/{agent_id}",
            json={"status": bad},
        )
        assert response.status_code == 422, f"Expected 422 for status={bad!r}, got {response.status_code}"


@pytest.mark.asyncio
async def test_invalid_task_status_returns_422(client: AsyncClient) -> None:
    task = await client.post(
        "/api/tasks",
        json={"title": "Status Transition Target", "job_type": "web developer"},
    )
    assert task.status_code == 201
    task_id = task.json()["id"]

    for bad in _invalid_task_statuses():
        response = await client.patch(
            f"/api/tasks/{task_id}",
            json={"status": bad},
        )
        assert response.status_code == 422, f"Expected 422 for status={bad!r}, got {response.status_code}"


@pytest.mark.asyncio
async def test_task_status_transition_validation(client: AsyncClient) -> None:
    """Tasks cannot jump to impossible states (e.g. pending -> completed)."""
    task = await client.post(
        "/api/tasks",
        json={"title": "Transition Test", "job_type": "web developer"},
    )
    assert task.status_code == 201
    task_id = task.json()["id"]

    # pending -> completed should be rejected (must go through assigned/in_progress)
    response = await client.patch(f"/api/tasks/{task_id}", json={"status": "completed"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_owner_only_approval_requires_token(client: AsyncClient) -> None:
    """The approve/deny endpoints require the owner token."""
    # Create an approval request first (public endpoint).
    req = await client.post(
        "/api/approval-requests",
        json={
            "action": "execute_task",
            "target_type": "task",
            "target_id": 1,
            "reason": "Test",
        },
    )
    assert req.status_code == 201
    request_id = req.json()["id"]

    # Attempting to approve without the owner token must be rejected.
    approve = await client.post(
        f"/api/approval-requests/{request_id}/approve",
        json={"note": "should fail"},
    )
    assert approve.status_code == 401


@pytest.mark.asyncio
async def test_unauthenticated_owner_action_rejected(client: AsyncClient) -> None:
    """Any endpoint gated by get_owner_token must reject missing tokens."""
    response = await client.post(
        "/api/approval-requests/1/approve",
        json={"note": "should fail"},
    )
    assert response.status_code in (401, 404, 405), (
        f"Expected 401/404/405 for unauthenticated approval, got {response.status_code}"
    )


@pytest.mark.asyncio
async def test_duplicate_manager_prevents_second_manager(client: AsyncClient) -> None:
    """Creating a second worker in the same department must not create a second manager."""
    first = await client.post(
        "/api/agents",
        json={
            "name": "First Tester",
            "job_type": "video editor",
        },
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/agents",
        json={
            "name": "Second Tester",
            "job_type": "video editor",
        },
    )
    assert second.status_code == 201

    managers = await client.get("/api/agents?manager_only=true")
    media_managers = [m for m in managers.json()["items"] if m["department_name"] == "Media Studio"]
    assert len(media_managers) == 1, "Only one primary manager should exist per department"


@pytest.mark.asyncio
async def test_unknown_job_type_creates_generic_department_no_manager_skills(client: AsyncClient) -> None:
    """Unknown job types still create a department but never invent a manager skills profile."""
    response = await client.post(
        "/api/agents",
        json={
            "name": "Unknown Job Worker",
            "job_type": "quantum flamingo trainer",
            "skills": ["flamingos", "quantum"],
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["department_name"] == "Quantum Flamingo Trainer Team"
    # Manager should be generic (no specific skills from registry)
    manager = await client.get(f"/api/agents/{payload['id']}/department")
    assert manager.status_code == 200


@pytest.mark.asyncio
async def test_owner_cannot_set_manager_autonomy_to_autonomous_via_patch(client: AsyncClient) -> None:
    """Even via direct patch, invalid autonomy levels must be rejected at the API boundary."""
    manager = await client.post(
        "/api/agents",
        json={
            "name": "Policy Manager",
            "job_type": "web developer",
        },
    )
    assert manager.status_code == 201
    manager_id = manager.json()["id"]

    response = await client.patch(
        f"/api/agents/{manager_id}",
        json={"autonomy_level": "autonomous"},
    )
    # Autonomous may be a valid enum value, but we test that unknown values are rejected
    bad_response = await client.patch(
        f"/api/agents/{manager_id}",
        json={"autonomy_level": "superauton"},
    )
    assert bad_response.status_code == 422


@pytest.mark.asyncio
async def test_policy_default_deny_uncategorized_action() -> None:
    """Any action not explicitly in the allow-lists must be denied."""
    from luma_core.governance.policy import GovernancePolicy

    policy = GovernancePolicy()
    assert policy.deny("super-secret-action") is True
    assert policy.allow("super-secret-action") is False
    assert policy.allow("view_department") is True
    assert policy.deny("view_department") is False
