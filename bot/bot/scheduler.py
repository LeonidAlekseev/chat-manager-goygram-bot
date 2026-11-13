import asyncio
import calendar
import logging
from datetime import date, datetime, tzinfo
from typing import Any

import asyncpg

from bot.sender import Telegram, send_template

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


async def deliver(db: asyncpg.Pool, tg: Telegram, log_id: int, telegram_id: int, t: Any, user: Any = None) -> None:
    """Sends template row `t` and records the outcome on the already-claimed log row."""
    try:
        msg = await send_template(tg, telegram_id, t, user)
    except Exception as e:
        log.exception("send to %s failed", telegram_id)
        await db.execute("UPDATE send_logs SET status = 'error', error = $2 WHERE id = $1", log_id, str(e))
        return
    await db.execute(
        "UPDATE send_logs SET status = 'sent', message_id = $2, poll_id = $3, error = $4 WHERE id = $1",
        log_id, msg["message_id"], (msg.get("poll") or {}).get("id"), msg.get("mention_error"),
    )


async def run_due(db: asyncpg.Pool, tg: Telegram, now: datetime, user: Any = None) -> None:
    """Sends every item due at `now` (aware, in TIMEZONE_NAME) to the active chats bound to its schedule.

    Inserting the (chat, item, slot) log row claims the send, so a restart within the minute sends
    nothing twice. A crash between the claim and the send leaves a `pending` row and the send is skipped.
    """
    slot = now.replace(second=0, microsecond=0, fold=0)  # a repeated DST hour maps to one slot
    rows = await db.fetch(
        "SELECT c.id AS chat_id, c.telegram_id, i.id AS item_id, i.time, i.start_date, i.period, "
        "t.id AS template_id, t.kind::text AS kind, t.text, t.options, t.anonymous, t.multiple, t.mention_all "
        "FROM chats c JOIN schedule_items i ON i.schedule_id = c.schedule_id "
        "JOIN templates t ON t.id = i.template_id "
        "WHERE c.active AND i.time = $1 ORDER BY c.id, i.id",
        slot.strftime("%H:%M"),
    )
    for r in rows:
        if not is_due(r["time"], r["start_date"], r["period"], slot):
            continue
        log_id = await db.fetchval(
            "INSERT INTO send_logs (chat_id, schedule_item_id, template_id, slot) VALUES ($1, $2, $3, $4) "
            "ON CONFLICT DO NOTHING RETURNING id",
            r["chat_id"], r["item_id"], r["template_id"], slot,
        )
        if log_id is None:
            continue  # already sent in this slot
        await deliver(db, tg, log_id, r["telegram_id"], r, user)


async def run_forever(db: asyncpg.Pool, tg: Telegram, tz: tzinfo, user: Any = None) -> None:
    while True:
        try:
            await run_due(db, tg, datetime.now(tz), user)
        except Exception:
            log.exception("scheduler tick failed")
        now = datetime.now(tz)
        await asyncio.sleep(60.5 - now.second - now.microsecond / 1e6)  # wake just past the next minute
