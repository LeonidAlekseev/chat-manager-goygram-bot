import logging
import re
from typing import Any

import asyncpg

from bot.sender import Telegram

log = logging.getLogger(__name__)

ACTIVE_STATUSES = {"member", "administrator", "creator", "restricted"}


async def handle_member_update(db: asyncpg.Pool, update: dict[str, Any]) -> None:
    """Register/deactivate a chat when the bot itself is added to or removed from it."""
    mem = update.get("my_chat_member")
    if not mem:
        return
    chat = mem["chat"]
    if chat.get("type") == "private":
        return
    active = mem["new_chat_member"]["status"] in ACTIVE_STATUSES
    if not active:
        # never inserts: the "left" update that follows a panel deletion must not bring the chat back
        await db.execute("UPDATE chats SET active = false, updated_at = now() WHERE telegram_id = $1", chat["id"])
        return
    # Title is set only on first insert so a rename made in the panel survives re-adding the bot.
    await db.execute(
        """
        INSERT INTO chats (telegram_id, title, active, updated_at) VALUES ($1, $2, $3, now())
        ON CONFLICT (telegram_id) DO UPDATE SET active = EXCLUDED.active, updated_at = now()
        """,
        chat["id"],
        chat.get("title") or str(chat["id"]),
        active,
    )


async def handle_group_migration(db: asyncpg.Pool, message: dict[str, Any]) -> None:
    """A basic group upgraded to a supergroup gets a new id; Telegram sends no new my_chat_member."""
    new_id = message.get("migrate_to_chat_id")
    if new_id:
        await migrate_chat(db, message["chat"]["id"], new_id)


async def migrate_chat(db: asyncpg.Pool, old_id: int, new_id: int) -> None:
    """Moves the chat to its new telegram_id, merging in a row the bot may already have for that id.

    The old row keeps its panel settings (title, schedule) and absorbs the other row's journal and jobs.
    """
    async with db.acquire() as conn, conn.transaction():
        chat_id = await conn.fetchval("SELECT id FROM chats WHERE telegram_id = $1 FOR UPDATE", old_id)
        if chat_id is None:
            return  # already migrated
        dup = await conn.fetchrow("SELECT id, active, schedule_id FROM chats WHERE telegram_id = $1 FOR UPDATE", new_id)
        if dup:
            # a slot both rows have keeps its better log (sent > pending > error); the other goes with the dup
            await conn.execute(
                "DELETE FROM send_logs o USING send_logs d WHERE o.chat_id = $1 AND d.chat_id = $2 "
                "AND o.schedule_item_id = d.schedule_item_id AND o.slot = d.slot "
                "AND array_position('{error,pending,sent}'::text[], d.status::text) "
                "> array_position('{error,pending,sent}'::text[], o.status::text)",
                chat_id, dup["id"],
            )
            await conn.execute(
                "UPDATE send_logs l SET chat_id = $1 WHERE chat_id = $2 AND NOT EXISTS (SELECT 1 FROM send_logs o "
                "WHERE o.chat_id = $1 AND o.schedule_item_id = l.schedule_item_id AND o.slot = l.slot)",
                chat_id, dup["id"],
            )
            await conn.execute("UPDATE outbox SET chat_id = $1 WHERE chat_id = $2", chat_id, dup["id"])
            await conn.execute("DELETE FROM chats WHERE id = $1", dup["id"])
        # the supergroup row knows whether the bot is still in the chat
        await conn.execute(
            "UPDATE chats SET telegram_id = $2, active = COALESCE($3, active), "
            "schedule_id = COALESCE(schedule_id, $4), updated_at = now() WHERE id = $1",
            chat_id, new_id, dup and dup["active"], dup and dup["schedule_id"],
        )


async def delete_chats(db: asyncpg.Pool, tg: Telegram) -> None:
    """Chats deleted in the panel: the bot leaves the group, then the row goes with its journal and jobs (FK cascade)."""
    for r in await db.fetch("SELECT id, telegram_id, active FROM chats WHERE deleting ORDER BY id"):
        if r["active"]:
            try:
                await tg.bot_req("leaveChat", chat_id=r["telegram_id"])
            except Exception as e:  # noqa: BLE001
                # 400/403 (chat not found, not a member, kicked): the bot is not there anyway; else retry next tick
                if not re.search(r"http 40[03]\b", str(e)):
                    log.warning("leaving chat %s failed: %s", r["telegram_id"], e)
                    continue
        await db.execute("DELETE FROM chats WHERE id = $1 AND deleting", r["id"])
