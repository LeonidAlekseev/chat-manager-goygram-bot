"""Is each assigned manager an admin of their chat (#99)? Bot commands such as /all answer admins only."""

import asyncio
import logging
import re

import asyncpg

from bot.mention import ADMIN_STATUSES
from bot.sender import Telegram

log = logging.getLogger(__name__)

# NULL checked_at: never checked, or queued again (a new assignment, a new Telegram link)
DUE = """
SELECT cm.chat_id, cm.manager_id, c.telegram_id, m.telegram_user_id
FROM chat_managers cm JOIN chats c ON c.id = cm.chat_id JOIN managers m ON m.id = cm.manager_id
WHERE m.telegram_user_id IS NOT NULL AND m.active AND c.active AND NOT c.deleting
  AND (cm.checked_at IS NULL OR cm.checked_at < now() - interval '1 day')
ORDER BY cm.checked_at NULLS FIRST LIMIT $1
"""
# The manager may have relinked another account meanwhile: that one stays due.
# unknown (a timeout, a 429, the network) keeps the last known status and is retried in about an hour.
STORE = """
UPDATE chat_managers SET
  member_status = CASE WHEN $3 = 'unknown' THEN COALESCE(member_status, $3) ELSE $3 END,
  checked_at = CASE WHEN $3 = 'unknown' THEN now() - interval '23 hours' ELSE now() END
WHERE chat_id = $1 AND manager_id = $2
  AND EXISTS (SELECT 1 FROM managers WHERE id = $2 AND telegram_user_id = $4)
"""


async def status_of(tg: Telegram, chat_id: int, user_id: int) -> str:
    """admin | member | absent | unknown (any other error: the bot left the chat, a timeout, …)."""
    try:
        m = await asyncio.wait_for(tg.bot_req("getChatMember", chat_id=chat_id, user_id=user_id), 30)
    except Exception as e:  # noqa: BLE001  any failure is a status the panel can show
        # GoyGram: "botapi getChatMember http 400: {..., 'description': 'Bad Request: user not found'}"
        return "absent" if re.search(r"user not found|PARTICIPANT_ID_INVALID", str(e), re.IGNORECASE) else "unknown"
    m = m.get("result", m)  # as in /all: bot_req may or may not unwrap "result"
    if m.get("status") in ADMIN_STATUSES:
        return "admin"
    if m.get("status") == "member" or (m.get("status") == "restricted" and m.get("is_member")):
        return "member"
    return "absent"


async def check_due(db: asyncpg.Pool, tg: Telegram, pause: float = 0.2, batch: int = 20) -> None:
    """One batch of due pairs; `pause` between calls keeps getChatMember well under the Bot API limits."""
    for r in await db.fetch(DUE, batch):
        status = await status_of(tg, r["telegram_id"], r["telegram_user_id"])
        await db.execute(STORE, r["chat_id"], r["manager_id"], status, r["telegram_user_id"])
        await asyncio.sleep(pause)


async def run_forever(db: asyncpg.Pool, tg: Telegram, interval: float = 5) -> None:
    while True:
        try:
            await check_due(db, tg)
        except Exception:
            log.exception("admin check tick failed")
        await asyncio.sleep(interval)
