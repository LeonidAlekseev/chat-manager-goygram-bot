import asyncio
import logging
from typing import Any

import asyncpg

log = logging.getLogger(__name__)


async def handle_poll_answer(db: asyncpg.Pool, update: dict[str, Any]) -> None:
    """Stores a user's vote in a non-anonymous poll; a changed or retracted vote (no options) overwrites it."""
    a = update.get("poll_answer")
    if not a or not a.get("user"):  # an anonymous voter (e.g. a group admin) arrives as voter_chat
        return
    u = a["user"]
    name = " ".join(filter(None, (u.get("first_name"), u.get("last_name")))) or u.get("username") or str(u["id"])
    await db.execute(
        "INSERT INTO poll_answers (poll_id, user_id, name, option_ids) VALUES ($1, $2, $3, $4) "
        "ON CONFLICT (poll_id, user_id) DO UPDATE SET name = EXCLUDED.name, option_ids = EXCLUDED.option_ids, updated_at = now()",
        a["poll_id"], u["id"], name, a["option_ids"],
    )


async def purge_old_polls(db: asyncpg.Pool) -> None:
    """Retention: poll answers and member snapshots are kept for a year."""
    await db.execute("DELETE FROM poll_answers WHERE updated_at < now() - interval '365 days'")
    await db.execute("DELETE FROM poll_members WHERE created_at < now() - interval '365 days'")


async def purge_forever(db: asyncpg.Pool) -> None:
    while True:  # on start, then monthly
        try:
            await purge_old_polls(db)
        except Exception:
            log.exception("poll retention failed")
        await asyncio.sleep(30 * 86400)
