"""«Найти группы бота» (#94): the panel queues a scan, the bot adds the account's groups it is a member of."""

import asyncio
import logging
from typing import Any

import asyncpg
from goygram.errors import FloodWaitError

from bot.mention import NO_SESSION, MentionError

log = logging.getLogger(__name__)

NO_ACCOUNT = "Аккаунт Telegram не подключён: войдите в него в Настройках, поиск групп идёт через него."
CLAIM = "UPDATE chat_discovery SET state = 'running', updated_at = now() WHERE id = 1 AND state = 'queued' RETURNING 1"


async def reset_running(db: asyncpg.Pool) -> None:
    """A scan cut by a restart runs again: nothing else would ever finish it."""
    await db.execute("UPDATE chat_discovery SET state = 'queued', updated_at = now() WHERE state = 'running'")


async def discover(db: asyncpg.Pool, user: Any) -> None:
    connected = await db.fetchval("SELECT api_session IS NOT NULL FROM settings WHERE id = 1")
    # a stored session the client has not restored yet (a restart, a login): the scan waits for it
    if connected and not user.ready():
        return
    if not await db.fetchval(CLAIM):
        return
    if not connected:
        return await _done(db, 0, 0, NO_ACCOUNT)
    found = added = 0
    error = None
    try:
        username = await db.fetchval("SELECT bot_username FROM settings WHERE id = 1")
        async for telegram_id, title in user.bot_groups(username):
            found += 1
            # an existing row stays as it is: a renamed one keeps its title, a deleting one is still deleted
            added += await db.fetchval(
                "INSERT INTO chats (telegram_id, title, updated_at) VALUES ($1, $2, now()) "
                "ON CONFLICT (telegram_id) DO NOTHING RETURNING 1",
                telegram_id, title,
            ) or 0
    except MentionError as e:
        error = NO_ACCOUNT if str(e) == NO_SESSION else str(e)  # NO_SESSION: a 401 ended the session mid-scan
    except FloodWaitError as e:
        error = f"Telegram ограничил запросы: повторите через {e.seconds} с."
    except Exception as e:  # any failure must reach the panel, not stop the loop
        log.exception("group scan failed")
        error = f"Ошибка: {str(e) or type(e).__name__}"
    await _done(db, found, added, error)


async def _done(db: asyncpg.Pool, found: int, added: int, error: str | None) -> None:
    log.info("group scan: found %d, added %d, error %s", found, added, error)
    await db.execute(
        "UPDATE chat_discovery SET state = 'done', found = $1, added = $2, error = $3, updated_at = now() WHERE id = 1",
        found, added, error,
    )


async def run_forever(db: asyncpg.Pool, user: Any, interval: float = 3) -> None:
    await reset_running(db)
    while True:
        try:
            await discover(db, user)
        except Exception:
            log.exception("group scan tick failed")
        await asyncio.sleep(interval)
