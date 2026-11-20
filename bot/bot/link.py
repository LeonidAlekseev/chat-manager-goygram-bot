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
        # The new account's admin statuses (#99) are checked again.
        linked = await db.fetchval(
            """
            WITH m AS (
                UPDATE managers SET telegram_user_id = $2, link_code = NULL, link_code_expires_at = NULL
                WHERE link_code = $1 AND link_code_expires_at > now() AND active RETURNING id
            ), queued AS (
                UPDATE chat_managers SET member_status = NULL, checked_at = NULL
                WHERE manager_id IN (SELECT id FROM m)
            )
            SELECT id FROM m
            """,
            code, message["from"]["id"])
    except asyncpg.UniqueViolationError:
        return "Этот Telegram-аккаунт уже привязан к другому менеджеру."
    if linked is None:
        return "Ссылка недействительна или устарела. Создайте новую в панели."
    return "Telegram привязан к вашему аккаунту в панели."

