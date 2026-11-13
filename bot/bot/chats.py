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
        await db.execute("UPDATE chats SET telegram_id = $2, updated_at = now() WHERE telegram_id = $1",
                         message["chat"]["id"], new_id)
