from typing import Any

import asyncpg

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
            # a log the old row already has for the same (item, slot) would break the unique key; it is dropped
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
