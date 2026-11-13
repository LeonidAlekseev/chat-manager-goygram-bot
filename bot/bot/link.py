from typing import Any

import asyncpg

PREFIX = "/start link_"


async def handle_link_start(db: asyncpg.Pool, message: dict[str, Any]) -> str | None:
    """Reply to `/start link_<code>` in private: binds the sender to the panel account that issued the code."""
    text = message.get("text") or ""
    if message["chat"]["type"] != "private" or not text.startswith(PREFIX):
        return None
    code = text[len(PREFIX):].strip()
    try:
        # One statement: the code is single-use and a disabled/expired one never matches.
        linked = await db.fetchval(
            """
            UPDATE managers SET telegram_user_id = $2, link_code = NULL, link_code_expires_at = NULL
            WHERE link_code = $1 AND link_code_expires_at > now() AND active RETURNING id
            """,
            code, message["from"]["id"])
    except asyncpg.UniqueViolationError:
        return "Этот Telegram-аккаунт уже привязан к другому менеджеру."
    if linked is None:
        return "Ссылка недействительна или устарела. Создайте новую в панели."
    return "Telegram привязан к вашему аккаунту в панели."


async def is_linked_manager(db: asyncpg.Pool, telegram_user_id: int) -> bool:
    """True if this Telegram user is linked to an active manager (used to gate manager-only commands)."""
    return bool(await db.fetchval(
        "SELECT EXISTS (SELECT 1 FROM managers WHERE telegram_user_id = $1 AND active)", telegram_user_id))
