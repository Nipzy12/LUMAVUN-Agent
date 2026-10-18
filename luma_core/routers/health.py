from fastapi import APIRouter

from luma_core.config import get_settings

router = APIRouter(prefix="/api", tags=["health"])
settings = get_settings()


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "luma-office",
        "environment": settings.app_env,
        "debug": settings.app_debug,
    }
