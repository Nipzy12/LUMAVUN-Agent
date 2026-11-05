"""Office routing and integration boundaries without browser dependencies."""
from pathlib import Path
import subprocess
import sys

import pytest
from luma_core.app import app
from luma_core.ui import mount_office_ui


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['/office', '/office/'])
async def test_office_served_automatically(client, path):
    response = await client.get(path)
    assert response.status_code == 200
    assert 'Chat baru' in response.text and 'PERCAKAPAN' in response.text
    assert 'maxlength="512"' in response.text
    assert response.headers['cache-control'] == 'no-store'
    assert "frame-ancestors 'none'" in response.headers['content-security-policy']


@pytest.mark.asyncio
@pytest.mark.parametrize('asset', ['app.js', 'styles.css'])
async def test_office_assets(client, asset):
    response = await client.get('/office/assets/' + asset)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'


@pytest.mark.asyncio
@pytest.mark.parametrize('asset', ['__init__.py', '.env', 'index.html', 'backup.db'])
async def test_office_asset_allowlist(client, asset):
    assert (await client.get('/office/assets/' + asset)).status_code == 404


def test_mount_and_installer_idempotent(tmp_path):
    before = len(app.routes)
    mount_office_ui(app)
    assert len(app.routes) == before
    repo = Path(__file__).resolve().parents[1]
    target = tmp_path / 'luma_core' / 'app.py'
    target.parent.mkdir()
    source = (repo / 'luma_core' / 'app.py').read_bytes()
    target.write_bytes(source)
    result = subprocess.run([sys.executable, str(repo / 'install_office_ui.py')], cwd=tmp_path,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0
    assert target.read_bytes() == source
    assert not list(tmp_path.rglob('*.backup*'))


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['/api/conversations', '/api/tasks', '/api/approval-requests', '/api/audit-events'])
async def test_private_api_responses_are_not_cacheable(client, path):
    response = await client.get(path)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert 'X-Luma-Owner-Token' in response.headers['vary']
