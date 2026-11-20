"""Chat photos for the panel (#113): the bot downloads each group's small photo into chat_photos."""

import asyncio
import logging
from typing import Any, Protocol

import asyncpg

log = logging.getLogger(__name__)

MAX_BYTES = 100 * 1024  # a 160×160 JPEG is ~10 KB
TIMEOUT = 30
# NULL photo_checked_at: a new chat, the bot added again, a photo change in the group
DUE = """
SELECT c.id, c.telegram_id, p.unique_id FROM chats c LEFT JOIN chat_photos p ON p.chat_id = c.id
WHERE c.active AND NOT c.deleting AND (c.photo_checked_at IS NULL OR c.photo_checked_at < now() - interval '1 day')
ORDER BY c.photo_checked_at NULLS FIRST LIMIT $1
"""
STORE = """
INSERT INTO chat_photos (chat_id, unique_id, mime, data) VALUES ($1, $2, 'image/jpeg', $3)
ON CONFLICT (chat_id) DO UPDATE SET unique_id = $2, mime = 'image/jpeg', data = $3, updated_at = now()
"""  # Bot API chat photos are always JPEG


class Telegram(Protocol):
    async def bot_req(self, meth: str, /, **kw: Any) -> Any: ...

    # GoyGram: getFile, then GET …/file/bot<token>/<path>; its errors carry no URL, so no token
    async def download_file(self, file_id: str) -> Any: ...


async def queue_photo(db: asyncpg.Pool, message: dict[str, Any]) -> None:
    if "new_chat_photo" in message or "delete_chat_photo" in message:
        await db.execute("UPDATE chats SET photo_checked_at = NULL WHERE telegram_id = $1", message["chat"]["id"])


async def sync_photo(db: asyncpg.Pool, tg: Telegram, chat_id: int, telegram_id: int, known: str | None) -> None:
    chat = await asyncio.wait_for(tg.bot_req("getChat", chat_id=telegram_id), TIMEOUT)
    chat = chat.get("result", chat)  # as in admins: bot_req may or may not unwrap "result"
    # a public group's @username for the panel's t.me link (#116); cleared when it is gone
    await db.execute("UPDATE chats SET username = $2 WHERE id = $1", chat_id, chat.get("username"))
    photo = chat.get("photo")
    if photo and photo["small_file_unique_id"] == known:
        return
    data = photo and await asyncio.wait_for(tg.download_file(photo["small_file_id"]), TIMEOUT)
    if data and len(data) > MAX_BYTES:
        log.warning("photo of chat %s is %d bytes, over %d: not stored", telegram_id, len(data), MAX_BYTES)
        data = None
    if data:
        await db.execute(STORE, chat_id, photo["small_file_unique_id"], data)
    else:
        await db.execute("DELETE FROM chat_photos WHERE chat_id = $1", chat_id)


async def check_due(db: asyncpg.Pool, tg: Telegram, pause: float = 0.5, batch: int = 20) -> None:
    """One batch of due chats; `pause` keeps getChat + getFile + download well under the Bot API limits."""
    for r in await db.fetch(DUE, batch):
        checked = "now()"
        try:
            await sync_photo(db, tg, r["id"], r["telegram_id"], r["unique_id"])
        except Exception as e:  # noqa: BLE001  a timeout, a 429, the bot left the chat: retried in about an hour
            log.warning("photo of chat %s failed: %s", r["telegram_id"], e)
            checked = "now() - interval '23 hours'"
        await db.execute(f"UPDATE chats SET photo_checked_at = {checked} WHERE id = $1", r["id"])
        await asyncio.sleep(pause)


async def run_forever(db: asyncpg.Pool, tg: Telegram, interval: float = 5) -> None:
    while True:
        try:
            await check_due(db, tg)
        except Exception:
            log.exception("photo check tick failed")
        await asyncio.sleep(interval)
