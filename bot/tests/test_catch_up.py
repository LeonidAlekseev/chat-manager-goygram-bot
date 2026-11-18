import asyncio
from datetime import date, datetime, timedelta

from bot.scheduler import fail_stuck, run_due, run_pending
from tests.test_sender import MSK, FakeTelegram, logs

T0 = datetime(2026, 3, 2, 7, 59, 0, tzinfo=MSK)


async def _bind(db, time: str) -> None:
    await db.execute("TRUNCATE send_logs, schedule_items, schedules, templates, chats RESTART IDENTITY CASCADE")
    t = await db.fetchval("INSERT INTO templates (name, kind, text) VALUES ('Ключ', 'text', 'Ключ') RETURNING id")
    s = await db.fetchval("INSERT INTO schedules (name) VALUES ('Смена') RETURNING id")
    await db.execute("INSERT INTO schedule_items (schedule_id, template_id, time, start_date, period) "
                     "VALUES ($1, $2, $3, $4, 'day')", s, t, time, date(2026, 3, 1))
    await db.execute("INSERT INTO chats (telegram_id, title, schedule_id) VALUES (-1001, 'ПВЗ', $1)", s)


async def test_a_tick_longer_than_a_minute_does_not_skip_the_next_minute(pool):
    await _bind(pool, "08:00")
    last = await run_pending(pool, FakeTelegram(), None, T0)
    tg = FakeTelegram()
    # the 07:59 tick took 70 s (429 retries), so the next one wakes at 08:01 and 08:00 was never "now"
    last = await run_pending(pool, tg, last, T0 + timedelta(minutes=2, seconds=0.5))
    assert [c[1]["chat_id"] for c in tg.calls] == [-1001]
    assert last == T0 + timedelta(minutes=2)


async def test_restart_catches_up_15_minutes_without_resending(pool):
    await _bind(pool, "08:00")
    tg = FakeTelegram()
    await run_pending(pool, tg, None, T0 + timedelta(minutes=17))  # started at 08:16
    assert tg.calls == []  # more than 15 minutes ago: dropped
    await run_pending(pool, tg, None, T0 + timedelta(minutes=16))  # started at 08:15
    assert len(tg.calls) == 1
    await run_pending(pool, tg, None, T0 + timedelta(minutes=16, seconds=30))  # another restart
    assert len(tg.calls) == 1


async def test_fail_stuck_spares_a_send_still_in_progress(pool):
    await _bind(pool, "08:00")
    gate = asyncio.Event()

    class Slow(FakeTelegram):
        async def bot_req(self, meth, **kw):
            await gate.wait()
            return await super().bot_req(meth, **kw)

    task = asyncio.create_task(run_due(pool, Slow(), T0 + timedelta(minutes=1)))
    while not await pool.fetchval("SELECT count(*) FROM send_logs"):
        await asyncio.sleep(0.01)
    await pool.execute("UPDATE send_logs SET created_at = now() - interval '1 hour'")  # a long send
    await fail_stuck(pool)
    gate.set()
    await task
    assert [r[1:] for r in await logs(pool)] == [("sent", 101, None, None)]
