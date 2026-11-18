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


async def handle_poll(db: asyncpg.Pool, update: dict[str, Any]) -> None:
    """Stores a poll's anonymity and vote counts; the only results Telegram gives for an anonymous poll."""
    p = update.get("poll")
    if not p:
        return
    await db.execute(
        "INSERT INTO poll_results (poll_id, anonymous, counts) VALUES ($1, $2, $3) ON CONFLICT (poll_id) "
        "DO UPDATE SET anonymous = EXCLUDED.anonymous, counts = EXCLUDED.counts, updated_at = now()",
        p["id"], p.get("is_anonymous", True), [o.get("voter_count", 0) for o in p.get("options", [])],
    )


CAP_BYTES = 100 * 2**20
# shortcut: per-row tuple header + index entries is a flat estimate, not measured; measure if the cap is overshot
ROW_OVERHEAD = 100
# (table, time column) of every journal table; nothing references them except send_logs -> outbox
JOURNAL = (("send_logs", "created_at"), ("outbox", "created_at"), ("poll_answers", "updated_at"),
           ("poll_members", "created_at"), ("poll_results", "updated_at"))
SIZE = "SELECT sum(pg_total_relation_size(t::regclass)) FROM unnest($1::text[]) t"
# The newest row that no longer fits under the cap: it and everything older goes. Sizes on disk do not shrink
# after DELETE (the space is reused), so the cut is chosen by the size of the live rows.
CUTOFF = (
    "SELECT t FROM (SELECT t, sum(b) OVER (ORDER BY t DESC ROWS UNBOUNDED PRECEDING) AS total FROM ("
    + " UNION ALL ".join(f"SELECT {col} AS t, pg_column_size(x.*) + $2 AS b FROM {tbl} x" for tbl, col in JOURNAL)
    + ") r) s WHERE total > $1 ORDER BY t DESC LIMIT 1"
)


async def purge_journals(db: asyncpg.Pool, cap: int = CAP_BYTES) -> None:
    """Retention: journal rows are kept for a year, and the oldest go while the journals exceed `cap` bytes.

    Pending sends and queued jobs stay. A job's outbox row goes before its log row: a job without a log
    row would be sent again.
    """
    async with db.acquire() as c, c.transaction():
        cut = None
        if await c.fetchval(SIZE, [t for t, _ in JOURNAL]) > cap:
            cut = await c.fetchval(CUTOFF, cap, ROW_OVERHEAD)
        # GREATEST ignores the NULL of "under the cap"
        before = "GREATEST(localtimestamp - interval '365 days', $1::timestamp)"
        await c.execute(
            "DELETE FROM outbox o USING send_logs l WHERE l.outbox_id = o.id AND l.status <> 'pending' "
            f"AND l.created_at <= {before}", cut)
        await c.execute(
            f"DELETE FROM send_logs WHERE status <> 'pending' AND outbox_id IS NULL AND created_at <= {before}", cut)
        for tbl, col in JOURNAL[2:]:
            await c.execute(f"DELETE FROM {tbl} WHERE {col} <= {before}", cut)


async def purge_forever(db: asyncpg.Pool) -> None:
    while True:  # on start, then daily
        try:
            await purge_journals(db)
        except Exception:
            log.exception("journal retention failed")
        await asyncio.sleep(86400)
