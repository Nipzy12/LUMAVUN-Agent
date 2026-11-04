"""Idempotently register the optional Luma Office UI in luma_core/app.py.

Run once from the repository root: python install_office_ui.py
No schema changes, dependency installs, database writes, or git operations.
"""
from pathlib import Path

APP = Path('luma_core/app.py')
SNIPPET = '\n\n# Optional Luma Office Chat + Work UI (existing APIs stay unchanged).\nfrom luma_core.ui import mount_office_ui\nmount_office_ui(app)\n'


def main():
    if not APP.is_file():
        raise SystemExit('Error: Run this from the LUMAVUN-Agent repository root (luma_core/app.py not found).')
    source = APP.read_text(encoding='utf-8')
    if 'mount_office_ui(app)' in source:
        print('UI already registered. Open http://127.0.0.1:8000/office')
        return
    if 'app = FastAPI(' not in source:
        raise SystemExit('Error: FastAPI app structure not recognized. Refusing to modify app.py.')
    if 'luma_core.ui' in source:
        raise SystemExit('Error: Existing UI integration found. Review app.py manually.')
    backup = APP.with_name('app.py.backup-before-office-ui')
    if not backup.exists():
        backup.write_text(source, encoding='utf-8')
        print(f'Backup created: {backup}')
    APP.write_text(source.rstrip() + SNIPPET, encoding='utf-8')
    print('UI installed. Start Uvicorn and open http://127.0.0.1:8000/office')


if __name__ == '__main__':
    main()
