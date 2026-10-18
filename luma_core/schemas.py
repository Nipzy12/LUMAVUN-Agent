from datetime import datetime, timezone

from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    status: str = "active"


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    status: str | None = None


class DepartmentResponse(BaseModel):
    id: int
    name: str
    description: str | None
    status: str
    agent_count: int
    created_at: str
    updated_at: str | None

    model_config = {"from_attributes": True}
