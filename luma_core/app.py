from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from luma_core.ui import mount_office_ui
from luma_core.routers import chat, images, studio, private_studio

from luma_core.config import get_settings
from luma_core.db.migrate import create_tables
from luma_core.providers.registry import create_registry
from luma_core.routers import agents, approval, audit, departments, health, tasks, conversations

settings = get_settings()
provider_registry = create_registry(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bootstrap the database schema on startup.
    # In a later phase this becomes a real migration step.
    await create_tables()
    yield
    # No teardown needed for SQLite in Phase 1.


app = FastAPI(
    title="Luma Office",
    version="0.1.0",
    description="Open-source, local-first, self-hostable AI workplace by Lumavun.",
    lifespan=lifespan,
)

app.include_router(private_studio.router)
app.include_router(studio.router)
app.include_router(images.router)
app.include_router(chat.router)
app.include_router(health.router)
app.include_router(departments.router)
app.include_router(agents.router)
app.include_router(tasks.router)
app.include_router(conversations.router)
app.include_router(approval.router)
app.include_router(audit.router)
mount_office_ui(app)


@app.get("/")
async def root() -> dict:
    return {
        "name": "Luma Office",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.middleware("http")
async def private_api_cache_headers(request, call_next):
    response = await call_next(request)
    if any(request.url.path == prefix or request.url.path.startswith(prefix + '/')
           for prefix in ('/api/studio', '/api/private-studio', '/api/images', '/api/chat', '/api/conversations', '/api/tasks', '/api/approval-requests', '/api/audit-events')):
        response.headers['Cache-Control'] = 'no-store'
        vary = response.headers.get('Vary', '')
        if 'x-luma-owner-token' not in [item.strip().lower() for item in vary.split(',')]:
            response.headers['Vary'] = ', '.join(filter(None, [vary, 'X-Luma-Owner-Token']))
        if request.url.path.startswith('/api/private-studio/'):
            response.headers['Vary'] = response.headers.get('Vary','') + ', X-Luma-Studio-Session'
    return response


@app.exception_handler(RequestValidationError)
async def private_chat_validation(request, exc):
    if request.url.path.startswith(('/api/chat/', '/api/images/', '/api/studio/', '/api/private-studio/')):
        # FastAPI's default validation includes rejected input verbatim.
        return JSONResponse(status_code=422, content={'detail': 'Invalid chat input'})
    return await request_validation_exception_handler(request, exc)
