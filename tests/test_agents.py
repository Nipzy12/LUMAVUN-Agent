import pytest

from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_agent_creates_department_and_primary_manager(client: AsyncClient) -> None:
    response = await client.post(
        "/api/agents",
        json={
            "name": "Ada Lovelace",
            "job_type": "web developer",
            "description": "Senior frontend engineer",
            "skills": ["react", "typescript"],
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "Ada Lovelace"
    assert payload["agent_type"] == "worker"
    assert payload["autonomy_level"] == "supervised"
    assert payload["status"] == "idle"
    assert payload["skills"] == ["react", "typescript"]
    assert payload["department_name"] == "Development"
    assert payload["managed_department_name"] is None

    agents = await client.get("/api/agents?manager_only=true")
    assert agents.status_code == 200
    manager_items = agents.json()["items"]
    assert any(m["role"] == "Dev Manager" and m["department_name"] == "Development" for m in manager_items)

    departments = await client.get("/api/departments")
    dept_names = {d["name"] for d in departments.json()["items"]}
    assert "Development" in dept_names


@pytest.mark.asyncio
async def test_duplicate_manager_not_created_on_second_worker(client: AsyncClient) -> None:
    first = await client.post(
        "/api/agents",
        json={
            "name": "First Editor",
            "job_type": "video editor",
            "skills": ["editing"],
        },
    )
    assert first.status_code == 201
    first_manager_role = first.json()["department_name"]

    second = await client.post(
        "/api/agents",
        json={
            "name": "Second Editor",
            "job_type": "video editor",
            "skills": ["color-grading"],
        },
    )
    assert second.status_code == 201

    managers = await client.get("/api/agents?manager_only=true")
    manager_items = managers.json()["items"]
    media_managers = [m for m in manager_items if m["department_name"] == "Media Studio"]
    assert len(media_managers) == 1
    assert media_managers[0]["role"] == "Media Manager"


@pytest.mark.asyncio
async def test_agent_default_autonomy_is_supervised(client: AsyncClient) -> None:
    response = await client.post(
        "/api/agents",
        json={
            "name": "Default Autonomy Agent",
            "job_type": "meme coin researcher",
        },
    )
    assert response.status_code == 201
    assert response.json()["autonomy_level"] == "supervised"


@pytest.mark.asyncio
async def test_create_task_routes_to_department_and_assigns_worker(client: AsyncClient) -> None:
    worker = await client.post(
        "/api/agents",
        json={
            "name": "Routing Worker",
            "job_type": "backend engineer",
            "skills": ["python"],
        },
    )
    assert worker.status_code == 201
    worker_id = worker.json()["id"]

    task = await client.post(
        "/api/tasks",
        json={"title": "Implement login flow", "job_type": "backend engineer"},
    )
    assert task.status_code == 201
    task_payload = task.json()
    assert task_payload["status"] == "in_progress"
    assert task_payload["assignee_name"] == "Routing Worker"
    assert task_payload["department_id"] is not None

    assigned = await client.get(f"/api/tasks/{task_payload['id']}")
    assert assigned.status_code == 200
    assert assigned.json()["assignee_name"] == "Routing Worker"


@pytest.mark.asyncio
async def test_task_without_suitable_worker_remains_unassigned(client: AsyncClient) -> None:
    task = await client.post(
        "/api/tasks",
        json={"title": "Solo trading research task", "job_type": "trader"},
    )
    assert task.status_code == 201
    task_payload = task.json()
    assert task_payload["status"] == "pending"
    assert task_payload["assignee_name"] is None


@pytest.mark.asyncio
async def test_list_agents_includes_manager_and_worker_roles(client: AsyncClient) -> None:
    await client.post(
        "/api/agents",
        json={"name": "Manager-Test Worker", "job_type": "frontend engineer"},
    )
    agents = await client.get("/api/agents")
    assert agents.status_code == 200
    items = agents.json()["items"]
    roles = {a["agent_type"] for a in items}
    assert "worker" in roles
    assert "manager" in roles


@pytest.mark.asyncio
async def test_list_approval_requests_empty_by_default(client: AsyncClient) -> None:
    response = await client.get("/api/approval-requests")
    assert response.status_code == 200
    assert response.json()["total"] == 0


@pytest.mark.asyncio
async def test_list_audit_events_empty_by_default(client: AsyncClient) -> None:
    response = await client.get("/api/audit-events")
    assert response.status_code == 200
    assert response.json()["total"] == 0
