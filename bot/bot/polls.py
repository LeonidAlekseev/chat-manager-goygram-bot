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
        "INSERT INTO poll_answers (poll_id, user_id, name, option_ids, first_name, last_name, username) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (poll_id, user_id) DO UPDATE SET name = EXCLUDED.name, "
        "option_ids = EXCLUDED.option_ids, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, "
        "username = EXCLUDED.username, updated_at = now()",
        a["poll_id"], u["id"], name, a["option_ids"], u.get("first_name"), u.get("last_name"), u.get("username"),
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
# shortcut: trims to 90% of the cap, so a day of new rows fits before the next run; lower it if a day writes more
TARGET = 0.9
JOURNAL = ("send_logs", "outbox", "poll_answers", "poll_members", "poll_results")
# Every row the purge may delete, at the time it goes, costing its table's bytes per row ($2..$6): a finished
# send, the outbox job of a finished send (it goes with its log), poll rows. Pending sends and queued jobs stay.
DELETABLE = (
    "SELECT created_at AS t, $2::float8 AS b FROM send_logs WHERE status <> 'pending' "
    "UNION ALL SELECT l.created_at, $3::float8 FROM outbox o JOIN send_logs l ON l.outbox_id = o.id "
    "WHERE l.status <> 'pending' "
    "UNION ALL SELECT updated_at, $4::float8 FROM poll_answers "
    "UNION ALL SELECT created_at, $5::float8 FROM poll_members "
    "UNION ALL SELECT updated_at, $6::float8 FROM poll_results"
)
# The time up to which deleting the oldest rows frees $1 bytes; the newest deletable row if nothing less does.
CUTOFF = (
    f"WITH r AS ({DELETABLE}) SELECT COALESCE((SELECT t FROM (SELECT t, sum(b) OVER "
    "(ORDER BY t ROWS UNBOUNDED PRECEDING) AS freed FROM r) s WHERE freed >= $1::float8 ORDER BY t LIMIT 1), "
    "(SELECT max(t) FROM r))"
)


async def journal_sizes(db: asyncpg.Pool) -> dict[str, int]:
    rows = await db.fetch("SELECT t, pg_total_relation_size(t::regclass) FROM unnest($1::text[]) t", list(JOURNAL))
    return {t: size for t, size in rows}


async def purge_journals(db: asyncpg.Pool, cap: int = CAP_BYTES, sizes: dict[str, int] | None = None) -> None:
    """Retention: journal rows are kept for a year, and while the journals take more than `cap` bytes on disk
    (tables, indexes, TOAST) the oldest go until they would take TARGET of it.

    A row costs its table's size / row count, so the estimate includes indexes and free space. VACUUM FULL then
    shrinks the files, so the next run sees the real size and deletes nothing more without new rows.
    A job's outbox row goes before its log row: a job without a log row would be sent again.
    """
    sizes = sizes or await journal_sizes(db)
    total = sum(sizes.values())
    cut = None
    async with db.acquire() as c, c.transaction():
        if total > cap:
            counts = await c.fetchrow("SELECT " + ", ".join(f"(SELECT count(*) FROM {t})" for t in JOURNAL))
            costs = [sizes[t] / max(n, 1) for t, n in zip(JOURNAL, counts, strict=True)]
            cut = await c.fetchval(CUTOFF, total - cap * TARGET, *costs)
        # GREATEST ignores the NULL of "under the cap"
        before = "GREATEST(localtimestamp - interval '365 days', $1::timestamp)"
        await c.execute(
            "DELETE FROM outbox o USING send_logs l WHERE l.outbox_id = o.id AND l.status <> 'pending' "
            f"AND l.created_at <= {before}", cut)
        await c.execute(
            f"DELETE FROM send_logs WHERE status <> 'pending' AND outbox_id IS NULL AND created_at <= {before}", cut)
        for table, col in (("poll_answers", "updated_at"), ("poll_members", "created_at"), ("poll_results", "updated_at")):
            await c.execute(f"DELETE FROM {table} WHERE {col} <= {before}", cut)
    if cut is None:
        return
    async with db.acquire() as c:  # the pool's RESET ALL on release drops lock_timeout
        # VACUUM FULL locks the table while it runs; if the bot or panel holds it, skip till tomorrow
        await c.execute("SET lock_timeout = '5s'")
        for t in JOURNAL:
            try:
                await c.execute(f"VACUUM FULL {t}")  # cannot run in a transaction
            except asyncpg.LockNotAvailableError:
                log.warning("journal %s busy, VACUUM FULL skipped", t)


async def purge_forever(db: asyncpg.Pool) -> None:
    while True:  # on start, then daily
        try:
            await purge_journals(db)
        except Exception:
            log.exception("journal retention failed")
        await asyncio.sleep(86400)
