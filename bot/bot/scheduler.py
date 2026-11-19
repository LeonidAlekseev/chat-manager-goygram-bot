import asyncio
import calendar
import logging
import re
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Any

import asyncpg

from bot.chats import migrate_chat
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


CATCH_UP = timedelta(minutes=15)  # how far back a late tick or a restart still sends
MINUTE = timedelta(minutes=1)
SEND_TIMEOUT = 60  # GoyGram sleeps through 429s for up to 5×300 s; one chat must not stall the tick

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
_sending: set[int] = set()  # log ids this process is delivering now
_unrecorded: dict[int, str] = {}  # log id → journal text, for outcomes that could not be written
SENT_UNRECORDED = "Сообщение отправлено, но статус не записан (ошибка базы данных)"
ERROR_UNRECORDED = "Отправка не удалась, но ошибка отправки не записана (ошибка базы данных)"


async def fail_stuck(db: asyncpg.Pool) -> None:
    """Marks pending rows left by a crash as errors; they are never re-sent, so no duplicates."""
    done = await db.fetch(
        "UPDATE send_logs l SET status = 'error', error = COALESCE("
        "(SELECT u.text FROM unnest($3::int[], $4::text[]) u(id, text) WHERE u.id = l.id), "
        "'Статус неизвестен: отправка прервана (бот перезапустился)') "
        "WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1) AND id <> ALL($2::int[]) "
        "RETURNING id",
        STUCK_MINUTES, list(_sending), list(_unrecorded), list(_unrecorded.values()),
    )
    for r in done:
        _unrecorded.pop(r["id"], None)


async def _record(db: asyncpg.Pool, log_id: int, lost: str, sql: str, *args: Any) -> None:
    """Writes a send's outcome, retrying once; a lost write is left to fail_stuck with the text `lost`."""
    for attempt in (1, 2):
        try:
            await db.execute(sql, log_id, *args)
            return
        except Exception:
            log.exception("send log write failed (attempt %d): %s", attempt, sql[:40])
    _unrecorded[log_id] = lost


async def _send(db: asyncpg.Pool, tg: Telegram, telegram_id: int, t: Any, user: Any) -> tuple[dict[str, Any], int]:
    """send_template that follows a group's upgrade to a supergroup once; returns the message and its chat."""
    try:
        return await send_template(tg, telegram_id, t, user), telegram_id
    except Exception as e:
        # GoyGram puts the Bot API error JSON (a dict repr) into the exception text
        moved = re.search(r"'migrate_to_chat_id': (-?\d+)", str(e))
        if not moved:
            raise
    new_id = int(moved[1])
    await migrate_chat(db, telegram_id, new_id)
    return await send_template(tg, new_id, t, user), new_id


async def deliver(
    db: asyncpg.Pool, tg: Telegram, log_id: int, telegram_id: int, t: Any, user: Any = None
) -> tuple[str, int] | None:
    """Sends template row `t` and records the outcome on the already-claimed log row.

    Returns (poll id, chat) if its chat members still need a snapshot (see snapshot_members).
    """
    _sending.add(log_id)
    try:
        try:
            async with (limit := asyncio.timeout(SEND_TIMEOUT)):
                msg, telegram_id = await _send(db, tg, telegram_id, t, user)
        except Exception as e:
            log.exception("send to %s failed", telegram_id)
            error = f"Отправка не завершилась за {SEND_TIMEOUT} с" if limit.expired() else str(e)
            await _record(db, log_id, ERROR_UNRECORDED,
                          "UPDATE send_logs SET status = 'error', error = $2 WHERE id = $1", error)
            return None
        poll_id = (msg.get("poll") or {}).get("id")
        await _record(
            db, log_id, SENT_UNRECORDED,
            "UPDATE send_logs SET status = 'sent', message_id = $2, poll_id = $3, error = $4 WHERE id = $1",
            msg.get("message_id"), poll_id, msg.get("mention_error"),
        )
    finally:
        _sending.discard(log_id)
    if poll_id and msg.get("member_ids"):
        await _save_members(db, poll_id, msg["member_ids"])
        return None
    return (poll_id, telegram_id) if poll_id and user is not None else None


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
        "t.source_chat_id, t.source_message_ids, t.correct_option_id, t.explanation "
        "FROM chats c JOIN schedule_items i ON i.schedule_id = c.schedule_id "
        "JOIN templates t ON t.id = i.template_id "
        # a chat bound or reactivated after the slot (both bump updated_at) does not get it on catch-up
        "WHERE c.active AND i.time = $1 AND c.updated_at < ($2::timestamptz AT TIME ZONE 'UTC') ORDER BY c.id, i.id",
        slot.strftime("%H:%M"), slot + MINUTE,
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
        if poll := await deliver(db, tg, log_id, r["telegram_id"], r, user):
            polls.append(poll)
    await snapshot_members(db, user, polls)




async def run_pending(db: asyncpg.Pool, tg: Telegram, last: datetime | None, now: datetime, user: Any = None) -> datetime:
    """Runs every minute after `last` up to `now`, at most CATCH_UP back; with no `last`, only `now`'s.

    A tick slower than a minute (429 retries, member fetches) or downtime would otherwise skip slots;
    re-running an already sent one sends nothing, as its log row exists. Only minutes after `last` are run,
    so an item added or moved into an already handled minute is not sent late. Returns the last minute run.
    """
    end = _minute(now)
    slot = end if last is None else max(_minute(last) + MINUTE, end - CATCH_UP)
    if last is not None and (lost := (slot - _minute(last)) // MINUTE - 1) > 0:
        log.warning("catch-up limit: skipped %d minute(s) of schedules after %s", lost, _minute(last))
    while slot <= end:
        await run_due(db, tg, slot.astimezone(now.tzinfo), user)
        slot += MINUTE
    return slot - MINUTE


def _minute(t: datetime) -> datetime:
    return t.astimezone(UTC).replace(second=0, microsecond=0)  # UTC steps: local time may jump at DST


async def run_forever(
    db: asyncpg.Pool, tg: Telegram, tz: tzinfo, user: Any = None, seen: datetime | None = None
) -> None:
    """`seen` is the previous process's last heartbeat: a restart catches up only the minutes it missed.

    shortcut: the heartbeat is the account loop's, not this loop's; a scheduler hung while the process
    lived would make a restart skip its minutes. Store the scheduler's own last minute if that matters.
    """
    last = seen and seen - MINUTE  # the heartbeat may land just before that minute's tick
    while True:
        try:
            await fail_stuck(db)  # the first tick is at startup
        except Exception:
            log.exception("fail_stuck failed")  # must not skip this tick's sends
        try:
            last = await run_pending(db, tg, last, datetime.now(tz), user)
        except Exception:
            log.exception("scheduler tick failed")  # `last` stays, so the next tick retries these minutes
        now = datetime.now(tz)
        await asyncio.sleep(60.5 - now.second - now.microsecond / 1e6)  # wake just past the next minute
