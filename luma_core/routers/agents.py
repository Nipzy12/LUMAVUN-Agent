from fastapi import APIRouter

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("")
async def list_agents() -> dict:
    # Phase 1: agents layer exists; full CRUD comes in a later phase.
    return {"items": [], "total": 0}
