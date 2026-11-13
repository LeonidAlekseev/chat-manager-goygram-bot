from typing import Any

import asyncpg


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
