import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

import asyncpg

from bot.scheduler import CLAIM, deliver, snapshot_members
from bot.sender import Telegram

log = logging.getLogger(__name__)


async def run_outbox(db: asyncpg.Pool, tg: Telegram, user: Any = None) -> None:
    """Sends every panel job that has no log row yet.

    Inserting the job's log row claims it, so a restart never sends a job twice. A crash between the
    claim and the send leaves a `pending` row and the job is skipped.
    """
    rows = await db.fetch(
        "SELECT o.id, o.chat_id, c.telegram_id, c.active, o.template_id, "
        "CASE WHEN o.text IS NOT NULL THEN 'text' ELSE t.kind::text END AS kind, "
        "COALESCE(o.text, t.text) AS text, t.options, t.anonymous, t.multiple, "
        "COALESCE(t.mention_all, false) AS mention_all "
        "FROM outbox o JOIN chats c ON c.id = o.chat_id LEFT JOIN templates t ON t.id = o.template_id "
        "WHERE NOT EXISTS (SELECT 1 FROM send_logs l WHERE l.outbox_id = o.id) ORDER BY o.id LIMIT 100"
    )
    polls = []
    for r in rows:
        log_id = await db.fetchval(CLAIM, r["chat_id"], None, r["template_id"], datetime.now(UTC), r["id"], r["text"], r["options"])
        if log_id is None:
            continue
        # the template was deleted, or the bot left the chat, after the job was queued
        error = "Шаблон удалён" if r["kind"] is None else None if r["active"] else "Бот удалён из чата"
        if error:
            await db.execute("UPDATE send_logs SET status = 'error', error = $2 WHERE id = $1", log_id, error)
            continue
        if poll_id := await deliver(db, tg, log_id, r["telegram_id"], r, user):
            polls.append((poll_id, r["telegram_id"]))
    await snapshot_members(db, user, polls)


async def run_forever(db: asyncpg.Pool, tg: Telegram, user: Any = None) -> None:
    while True:
        try:
            await run_outbox(db, tg, user)
        except Exception:
            log.exception("outbox tick failed")
        await asyncio.sleep(3)
