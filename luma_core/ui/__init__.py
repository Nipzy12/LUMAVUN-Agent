"""Dependency-free same-origin Chat/Work UI; static assets are allowlisted."""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

UI_DIR = Path(__file__).resolve().parent
UI_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; "
                               "connect-src 'self'; img-src 'self' data:; object-src 'none'; "
                               "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}


def mount_office_ui(app: FastAPI) -> None:
    if any(getattr(route, 'path', None) == '/office' for route in app.routes):
        return

    async def index() -> FileResponse:
        return FileResponse(UI_DIR / 'index.html', media_type='text/html', headers=UI_HEADERS)

    async def asset(asset_name: str) -> FileResponse:
        media = {'app.js': 'text/javascript', 'studio.js': 'text/javascript', 'styles.css': 'text/css'}
        if asset_name not in media:
            raise HTTPException(404, 'Asset not found')
        return FileResponse(UI_DIR / asset_name, media_type=media[asset_name], headers=UI_HEADERS)

    app.add_api_route('/office', index, methods=['GET'], include_in_schema=False)
    app.add_api_route('/office/', index, methods=['GET'], include_in_schema=False)
    app.add_api_route('/office/assets/{asset_name}', asset, methods=['GET'], include_in_schema=False)
