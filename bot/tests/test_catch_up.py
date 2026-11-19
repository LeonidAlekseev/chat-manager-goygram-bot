import asyncio
from datetime import date, datetime, timedelta

from bot.scheduler import fail_stuck, run_due, run_pending
from tests.test_sender import MSK, FakeTelegram, logs

T0 = datetime(2026, 3, 2, 7, 59, 0, tzinfo=MSK)
MIN = timedelta(minutes=1)


async def _bind(db, time: str) -> None:
    await db.execute("TRUNCATE send_logs, schedule_items, schedules, templates, chats RESTART IDENTITY CASCADE")
    await db.execute("INSERT INTO templates (name, kind, text) VALUES ('Ключ', 'text', 'Ключ')")
    await db.execute("INSERT INTO schedules (name) VALUES ('Смена')")
    await db.execute("INSERT INTO schedule_items (schedule_id, template_id, time, start_date, period) "
                     "VALUES (1, 1, $1, $2, 'day')", time, date(2026, 3, 1))
    await db.execute("INSERT INTO chats (telegram_id, title, schedule_id, updated_at) "
                     "VALUES (-1001, 'ПВЗ', 1, '2026-01-01')")


async def test_a_tick_longer_than_a_minute_does_not_skip_the_next_minute(pool):
    await _bind(pool, "08:00")
    last = await run_pending(pool, FakeTelegram(), None, T0)
    tg = FakeTelegram()
    # the 07:59 tick took 70 s (429 retries), so the next one wakes at 08:01 and 08:00 was never "now"
    last = await run_pending(pool, tg, last, T0 + 2 * MIN + timedelta(seconds=0.5))
    assert [c[1]["chat_id"] for c in tg.calls] == [-1001]
    assert last == T0 + 2 * MIN


async def test_restart_catches_up_since_the_last_heartbeat_without_resending(pool):
    await _bind(pool, "08:00")
    tg = FakeTelegram()
    await run_pending(pool, tg, T0 - 20 * MIN, T0 + 17 * MIN)  # down 07:39–08:16: 08:00 is over 15 min ago
    assert tg.calls == []
    await run_pending(pool, tg, T0 + timedelta(seconds=30), T0 + 11 * MIN)  # last heartbeat 07:59:30, back at 08:10
    assert len(tg.calls) == 1
    await run_pending(pool, tg, T0 - MIN, T0 + 11 * MIN)  # another restart re-runs 07:59–08:10
    assert len(tg.calls) == 1


async def test_first_start_sends_nothing_from_the_past(pool):
    await _bind(pool, "08:00")
    tg = FakeTelegram()
    await run_pending(pool, tg, None, T0 + 6 * MIN)  # no heartbeat: nothing to catch up on
    assert tg.calls == []


async def test_catch_up_skips_a_chat_bound_or_reactivated_after_the_slot(pool):
    await _bind(pool, "08:00")
    # the panel (Prisma @updatedAt) and the bot (my_chat_member) bump updated_at on binding/activation
    await pool.execute("UPDATE chats SET updated_at = $1::timestamptz AT TIME ZONE 'UTC'", T0 + 6 * MIN)  # 08:05
    tg = FakeTelegram()
    await run_pending(pool, tg, T0 - MIN, T0 + 7 * MIN)  # restart at 08:06, last heartbeat 07:58
    assert tg.calls == []


async def test_an_item_moved_or_added_into_the_past_is_not_sent(pool):
    await _bind(pool, "09:00")
    tg = FakeTelegram()
    last = await run_pending(pool, tg, None, T0 + 2 * MIN)  # 08:01
    await pool.execute("UPDATE schedule_items SET time = '08:00'")  # edited at 08:01:30
    await pool.execute("INSERT INTO schedule_items (schedule_id, template_id, time, start_date, period) "
                       "VALUES (1, 1, '08:01', $1, 'day')", date(2026, 3, 1))  # created with a past time
    await run_pending(pool, tg, last, T0 + 3 * MIN)
    assert tg.calls == []


async def test_fail_stuck_spares_a_send_still_in_progress(pool):
    await _bind(pool, "08:00")
    gate = asyncio.Event()

    class Slow(FakeTelegram):
        async def bot_req(self, meth, **kw):
            await gate.wait()
            return await super().bot_req(meth, **kw)

    task = asyncio.create_task(run_due(pool, Slow(), T0 + MIN))
    while not await pool.fetchval("SELECT count(*) FROM send_logs") and not task.done():
        await asyncio.sleep(0.01)
    await pool.execute("UPDATE send_logs SET created_at = now() - interval '1 hour'")  # a long send
    await fail_stuck(pool)
    gate.set()
    await task
    assert [r[1:] for r in await logs(pool)] == [("sent", 101, None, None)]


async def test_a_hung_send_is_cut_off_and_journaled_as_an_error(pool, monkeypatch):
    await _bind(pool, "08:00")
    monkeypatch.setattr("bot.sender.SEND_TIMEOUT", 0.05)

    class Hung(FakeTelegram):
        async def bot_req(self, meth, **kw):
            await asyncio.Event().wait()  # e.g. 429 retries that sleep for minutes

    await asyncio.wait_for(run_due(pool, Hung(), T0 + MIN), 1)
    [(_, status, _, _, error)] = await logs(pool)
    assert (status, error) == ("error", "Отправка не завершилась за 0.05 с (возможно, отправлено)")


async def test_a_hung_mention_part_keeps_the_poll_sent(pool, monkeypatch):
    from tests.test_sender_mentions import User

    await _bind(pool, "08:00")
    await pool.execute("UPDATE templates SET kind = 'poll', options = '{a,b}', mention_all = true")
    monkeypatch.setattr("bot.sender.SEND_TIMEOUT", 0.05)

    class MentionHangs(FakeTelegram):
        async def bot_req(self, meth, **kw):
            if meth == "sendMessage":
                await asyncio.Event().wait()
            return await super().bot_req(meth, **kw)

    await asyncio.wait_for(run_due(pool, MentionHangs(), T0 + MIN, User()), 1)
    [(_, status, message_id, poll_id, error)] = await logs(pool)
    assert (status, message_id, poll_id) == ("sent", 101, "poll-1") and "не завершилась" in error


async def test_minutes_dropped_by_the_catch_up_limit_are_logged(pool, caplog):
    await _bind(pool, "08:00")
    await run_pending(pool, FakeTelegram(), T0 - 20 * MIN, T0 + 17 * MIN)  # back at 08:16: only 08:01–08:16 run
    assert "skipped 21 minute(s)" in caplog.text
    caplog.clear()
    await run_pending(pool, FakeTelegram(), T0, T0 + 2 * MIN)
    assert "skipped" not in caplog.text
