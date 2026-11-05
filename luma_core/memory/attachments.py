"""Bounded parsers and explicit owner-authorized attachment retention."""
import asyncio
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
from uuid import UUID

from sqlalchemy import delete, select, update
from luma_core.models import ChatAttachment, AttachmentRetention

PARSER_TIMEOUT = 8
_parser_slots = asyncio.Semaphore(2)


async def parse_attachment(data: bytes, kind: str) -> str:
    if kind == 'text/plain':
        text = data.decode('utf-8')
        if '\x00' in text or len(text) > 20000:
            raise ValueError('Invalid text')
        return text
    if kind not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'):
        raise ValueError('Unsupported type')
    async with _parser_slots:
        # Fixed trusted parser entry point; never a shell or user-supplied command.
        process = await asyncio.create_subprocess_exec(
            sys.executable, '-m', 'luma_core.memory.attachment_parser', kind,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL)
        try:
            output, _ = await asyncio.wait_for(process.communicate(data), PARSER_TIMEOUT)
            if process.returncode != 0 or len(output) > 80000:
                raise ValueError('Invalid or over-budget attachment')
            return output.decode('utf-8')
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()


async def cleanup_attachments(session, settings, owner):
    """Never delete linked rows/files. Serialize binding, upload and cleanup in SQLite."""
    await session.execute(update(ChatAttachment).where(ChatAttachment.id == '').values(name=ChatAttachment.name))
    current = datetime.now(timezone.utc)
    cutoff = current - timedelta(hours=settings.chat_attachment_ttl_hours)
    root = Path(settings.chat_attachment_dir).resolve()
    rows = (await session.scalars(select(ChatAttachment).where(ChatAttachment.owner == owner))).all()
    removed = 0
    for row in rows:
        if row.conversation_id is not None:
            continue  # Retain even if the conversation's metadata is damaged/missing.
        stamp = await session.get(AttachmentRetention, row.id)
        if stamp is None:
            # Legacy rows have no trustworthy age: start a fresh grace period, never infer expiry.
            session.add(AttachmentRetention(attachment_id=row.id, created_at=current.isoformat()))
            continue
        try:
            created = datetime.fromisoformat(stamp.created_at)
            if created.tzinfo is None or created > cutoff:
                continue
            if str(UUID(row.id)) != row.id:
                continue
        except ValueError:
            continue
        path = root / row.id
        if path.is_symlink():
            continue
        try:
            if path.exists():
                if not path.is_file():
                    continue
                path.unlink()
        except OSError:
            continue  # Retry later; never claim a file deletion that failed.
        await session.execute(delete(AttachmentRetention).where(AttachmentRetention.attachment_id == row.id))
        await session.delete(row)
        removed += 1
    await session.flush()
    known = set((await session.scalars(select(ChatAttachment.id))).all())  # all owners, all conversations
    orphans = 0
    if root.is_dir():
        for path in root.iterdir():
            try:
                if str(UUID(path.name)) != path.name or path.name in known or path.is_symlink():
                    continue
                if path.is_file() and path.stat().st_mtime <= cutoff.timestamp():
                    path.unlink()
                    orphans += 1
            except (ValueError, OSError):
                continue
    return {'expired_attachments_removed': removed, 'orphan_files_removed': orphans}
