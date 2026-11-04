"""Optional, dependency-free web UI for the existing Luma Office FastAPI app."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


UI_DIR = Path(__file__).resolve().parent


def mount_office_ui(app: FastAPI) -> None:
    """Expose /office without changing the existing / and /api endpoints."""
    if any(getattr(route, 'path', None) == '/office' for route in app.routes):
        return

    async def index() -> FileResponse:
        return FileResponse(UI_DIR / 'index.html', media_type='text/html', headers={
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
        })

    app.add_api_route('/office', index, methods=['GET'], include_in_schema=False)
    app.add_api_route('/office/', index, methods=['GET'], include_in_schema=False)
    app.mount('/office/assets', StaticFiles(directory=str(UI_DIR), html=False), name='office-assets')
