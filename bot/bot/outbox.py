import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

import asyncpg

from bot.chats import delete_chats
from bot.scheduler import CATCH_UP, CLAIM, deliver, snapshot_members
from bot.sender import Telegram

log = logging.getLogger(__name__)


async def run_outbox(db: asyncpg.Pool, tg: Telegram, user: Any = None) -> None:
    """Sends every panel job that is due and has no log row yet.

    Inserting the job's log row claims it, so a restart never sends a job twice. A crash between the
    claim and the send leaves a `pending` row: the job is skipped, and fail_stuck later marks it an error.
    """
    rows = await db.fetch(
        "SELECT o.id, o.chat_id, c.telegram_id, c.active, o.template_id, "
        # custom text, or a custom poll (text = question) when it has options; else the template's own fields
        "CASE WHEN o.text IS NULL THEN t.kind::text WHEN cardinality(o.options) > 0 THEN 'poll' ELSE 'text' END AS kind, "
        "COALESCE(o.text, t.text) AS text, "
        "CASE WHEN o.text IS NOT NULL THEN o.options ELSE t.options END AS options, "
        "CASE WHEN o.text IS NOT NULL THEN o.anonymous ELSE t.anonymous END AS anonymous, "
        "CASE WHEN o.text IS NOT NULL THEN o.multiple ELSE t.multiple END AS multiple, "
        "CASE WHEN o.text IS NOT NULL THEN o.mention_all ELSE COALESCE(t.mention_all, false) END AS mention_all, "
        "t.source_chat_id, t.source_message_ids, "
        "t.correct_option_id, t.explanation, "
        # as with schedules: a scheduled job found too late (the bot was down) is not sent at a surprising time
        "o.send_at < (now() AT TIME ZONE 'UTC') - $1::interval AS late "
        "FROM outbox o JOIN chats c ON c.id = o.chat_id LEFT JOIN templates t ON t.id = o.template_id "
        # a deleting chat's jobs are never sent; they go with the chat (FK cascade)
        "WHERE NOT c.deleting AND NOT EXISTS (SELECT 1 FROM send_logs l WHERE l.outbox_id = o.id) "
        # send_at is UTC without a zone (Prisma DateTime); a later job waits, NULL = at once
        "AND (o.send_at IS NULL OR o.send_at <= now() AT TIME ZONE 'UTC') "
        "ORDER BY o.id LIMIT 100",
        CATCH_UP,
    )
    polls = []
    for r in rows:
        try:
            log_id = await db.fetchval(
                CLAIM, r["chat_id"], None, r["template_id"], datetime.now(UTC), r["id"], r["text"], r["options"]
            )
        except asyncpg.ForeignKeyViolationError:
            continue  # cancelled in the panel after it was read
        if log_id is None:
            continue
        # the template was deleted, or the bot left the chat, after the job was queued
        error = (
            "Шаблон удалён" if r["kind"] is None
            else "Бот удалён из чата" if not r["active"]
            else "Не отправлено: бот был недоступен, время прошло" if r["late"]
            else None
        )
        if error:
            await db.execute("UPDATE send_logs SET status = 'error', error = $2 WHERE id = $1", log_id, error)
            continue
        if poll := await deliver(db, tg, log_id, r["telegram_id"], r, user):
            polls.append(poll)
    await snapshot_members(db, user, polls)


async def run_forever(db: asyncpg.Pool, tg: Telegram, user: Any = None) -> None:
    while True:
        try:
            await delete_chats(db, tg)  # first, so a deleted chat's queued jobs go with it unsent
            await run_outbox(db, tg, user)
        except Exception:
            log.exception("outbox tick failed")
        await asyncio.sleep(3)
