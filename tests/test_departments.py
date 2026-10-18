import pytest

from luma_core.models import DepartmentStatus


@pytest.mark.asyncio
async def test_create_and_list_departments(client: AsyncClient) -> None:
    response = await client.post(
        "/api/departments",
        json={"name": "Engineering", "description": "Core platform team"},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "Engineering"
    assert payload["description"] == "Core platform team"
    assert payload["status"] == "active"
    assert payload["agent_count"] == 0
    department_id = payload["id"]
    assert payload["created_at"]
    assert payload["updated_at"]

    response = await client.get("/api/departments")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Engineering"


@pytest.mark.asyncio
async def test_list_departments_filters_by_status(client: AsyncClient) -> None:
    await client.post(
        "/api/departments",
        json={"name": "Active Dept", "status": DepartmentStatus.active.value},
    )
    await client.post(
        "/api/departments",
        json={"name": "Archived Dept", "status": DepartmentStatus.archived.value},
    )

    response = await client.get(
        "/api/departments",
        params={"status": DepartmentStatus.active.value},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Active Dept"


@pytest.mark.asyncio
async def test_get_department_by_id(client: AsyncClient) -> None:
    response = await client.post(
        "/api/departments",
        json={"name": "Research"},
    )
    department_id = response.json()["id"]

    response = await client.get(f"/api/departments/{department_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Research"


@pytest.mark.asyncio
async def test_get_nonexistent_department_returns_404(client: AsyncClient) -> None:
    response = await client.get("/api/departments/99999")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_department(client: AsyncClient) -> None:
    response = await client.post(
        "/api/departments",
        json={"name": "Old Name"},
    )
    department_id = response.json()["id"]

    response = await client.patch(
        f"/api/departments/{department_id}",
        json={"name": "New Name", "description": "Updated"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "New Name"
    assert payload["description"] == "Updated"
    assert payload["updated_at"]


@pytest.mark.asyncio
async def test_delete_department(client: AsyncClient) -> None:
    response = await client.post(
        "/api/departments",
        json={"name": "To Delete"},
    )
    department_id = response.json()["id"]

    delete_response = await client.delete(f"/api/departments/{department_id}")
    assert delete_response.status_code == 204

    get_response = await client.get(f"/api/departments/{department_id}")
    assert get_response.status_code == 404
