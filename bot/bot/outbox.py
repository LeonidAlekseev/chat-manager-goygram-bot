import asyncio
import logging
from typing import Any

import asyncpg

from bot.scheduler import deliver
from bot.sender import Telegram

log = logging.getLogger(__name__)


async def run_outbox(db: asyncpg.Pool, tg: Telegram, user: Any = None) -> None:
    """Sends every panel job that has no log row yet.

    Inserting the job's log row claims it, so a restart never sends a job twice. A crash between the
    claim and the send leaves a `pending` row and the job is skipped.
    """
    rows = await db.fetch(
        "SELECT o.id, o.chat_id, c.telegram_id, o.template_id, "
        "CASE WHEN o.text IS NOT NULL THEN 'text' ELSE t.kind::text END AS kind, "
        "COALESCE(o.text, t.text) AS text, t.options, t.anonymous, t.multiple, "
        "COALESCE(t.mention_all, false) AS mention_all "
        "FROM outbox o JOIN chats c ON c.id = o.chat_id LEFT JOIN templates t ON t.id = o.template_id "
        "WHERE NOT EXISTS (SELECT 1 FROM send_logs l WHERE l.outbox_id = o.id) ORDER BY o.id LIMIT 100"
    )
    for r in rows:
        log_id = await db.fetchval(
            "INSERT INTO send_logs (chat_id, template_id, slot, outbox_id) VALUES ($1, $2, now(), $3) "
            "ON CONFLICT DO NOTHING RETURNING id",
            r["chat_id"], r["template_id"], r["id"],
        )
        if log_id is None:
            continue
        if r["kind"] is None:  # the template was deleted after the job was queued
            await db.execute("UPDATE send_logs SET status = 'error', error = 'Шаблон удалён' WHERE id = $1", log_id)
            continue
        await deliver(db, tg, log_id, r["telegram_id"], r, user)


async def run_forever(db: asyncpg.Pool, tg: Telegram, user: Any = None) -> None:
    while True:
        try:
            await run_outbox(db, tg, user)
        except Exception:
            log.exception("outbox tick failed")
        await asyncio.sleep(3)
