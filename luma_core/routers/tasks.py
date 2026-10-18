from fastapi import APIRouter

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("")
async def list_tasks() -> dict:
    # Phase 1: tasks layer exists; full CRUD comes in a later phase.
    return {"items": [], "total": 0}
