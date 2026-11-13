import asyncio
import calendar
import logging
from datetime import date, datetime, tzinfo
from typing import Any

import asyncpg

from bot.sender import FETCH_TIMEOUT, Telegram, fetch_members, send_template

log = logging.getLogger(__name__)


def is_due(time: str, start: date, period: str, now: datetime) -> bool:
    """Whether a schedule item fires at the local minute `now`."""
    today = now.date()
    if now.strftime("%H:%M") != time or today < start:
        return False
    days = (today - start).days
    if period == "none":
        return days == 0
    if period == "day":
        return True
    if period == "week":
        return days % 7 == 0
    if period == "twoweek":
        return days % 14 == 0
    if period == "month":
        # Start on the 31st fires on the last day of shorter months.
        return today.day == min(start.day, calendar.monthrange(today.year, today.month)[1])
    return False


CLAIM = (
    "INSERT INTO send_logs (chat_id, schedule_item_id, template_id, slot, outbox_id, text, options) "
    "VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::text[], '{}')) ON CONFLICT DO NOTHING RETURNING id"
)  # the row keeps what is sent, so the journal does not follow later template edits


async def _write(db: asyncpg.Pool, sql: str, *args: Any) -> None:
    # The message is already out: a failed log write must not abort the rest of the tick.
    try:
        await db.execute(sql, *args)
    except Exception:
        log.exception("send log write failed: %s", sql[:40])


STUCK_MINUTES = 5  # a send takes seconds; an older pending row means the bot died after the claim


async def fail_stuck(db: asyncpg.Pool) -> None:
    """Marks pending rows left by a crash as errors; they are never re-sent, so no duplicates."""
    await db.execute(
        "UPDATE send_logs SET status = 'error', error = 'Отправка прервана (бот перезапустился)' "
        "WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1)",
        STUCK_MINUTES,
    )


async def deliver(db: asyncpg.Pool, tg: Telegram, log_id: int, telegram_id: int, t: Any, user: Any = None) -> str | None:
    """Sends template row `t` and records the outcome on the already-claimed log row.

    Returns the poll id if its chat members still need a snapshot (see snapshot_members).
    """
    try:
        msg = await send_template(tg, telegram_id, t, user)
    except Exception as e:
        log.exception("send to %s failed", telegram_id)
        await _write(db, "UPDATE send_logs SET status = 'error', error = $2 WHERE id = $1", log_id, str(e))
        return None
    poll_id = (msg.get("poll") or {}).get("id")
    await _write(
        db,
        "UPDATE send_logs SET status = 'sent', message_id = $2, poll_id = $3, error = $4 WHERE id = $1",
        log_id, msg["message_id"], poll_id, msg.get("mention_error"),
    )
    if poll_id and msg.get("member_ids"):
        await _save_members(db, poll_id, msg["member_ids"])
        return None
    return poll_id if user is not None else None


async def _save_members(db: asyncpg.Pool, poll_id: str, ids: list[int]) -> None:
    await _write(
        db,
        "INSERT INTO poll_members (poll_id, user_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING",
        poll_id, ids,
    )


async def snapshot_members(db: asyncpg.Pool, user: Any, polls: list[tuple[str, int]]) -> None:
    """Stores the chat members of just-sent (poll_id, telegram_id) polls for "who didn't answer".

    Runs after every send of the tick, so a slow member fetch delays no message; all fetches share one
    FETCH_TIMEOUT budget so a hung client cannot make the next tick miss its minute.
    """
    try:
        async with asyncio.timeout(FETCH_TIMEOUT):
            for poll_id, telegram_id in polls:
                try:
                    ids = await fetch_members(user, telegram_id)
                except Exception as e:  # noqa: BLE001  no list just means the answers page shows none
                    log.warning("members of %s unavailable: %s", telegram_id, str(e) or type(e).__name__)
                    continue
                if ids:
                    await _save_members(db, poll_id, ids)
    except TimeoutError:
        log.warning("member snapshot ran out of time")


async def run_due(db: asyncpg.Pool, tg: Telegram, now: datetime, user: Any = None) -> None:
    """Sends every item due at `now` (aware, in TIMEZONE_NAME) to the active chats bound to its schedule.

    Inserting the (chat, item, slot) log row claims the send, so a restart within the minute sends
    nothing twice. A crash between the claim and the send leaves a `pending` row: the send is skipped, and fail_stuck later marks it an error.
    """
    slot = now.replace(second=0, microsecond=0, fold=0)  # a repeated DST hour maps to one slot
    rows = await db.fetch(
        "SELECT c.id AS chat_id, c.telegram_id, i.id AS item_id, i.time, i.start_date, i.period, "
        "t.id AS template_id, t.kind::text AS kind, t.text, t.options, t.anonymous, t.multiple, t.mention_all, "
        "t.source_chat_id, t.source_message_id "
        "FROM chats c JOIN schedule_items i ON i.schedule_id = c.schedule_id "
        "JOIN templates t ON t.id = i.template_id "
        "WHERE c.active AND i.time = $1 ORDER BY c.id, i.id",
        slot.strftime("%H:%M"),
    )
    polls = []
    for r in rows:
        if not is_due(r["time"], r["start_date"], r["period"], slot):
            continue
        log_id = await db.fetchval(
            CLAIM, r["chat_id"], r["item_id"], r["template_id"], slot, None, r["text"], r["options"]
        )
        if log_id is None:
            continue  # already sent in this slot
        if poll_id := await deliver(db, tg, log_id, r["telegram_id"], r, user):
            polls.append((poll_id, r["telegram_id"]))
    await snapshot_members(db, user, polls)


async def run_forever(db: asyncpg.Pool, tg: Telegram, tz: tzinfo, user: Any = None) -> None:
    while True:
        try:
            await fail_stuck(db)  # the first tick is at startup
            await run_due(db, tg, datetime.now(tz), user)
        except Exception:
            log.exception("scheduler tick failed")
        now = datetime.now(tz)
        await asyncio.sleep(60.5 - now.second - now.microsecond / 1e6)  # wake just past the next minute
