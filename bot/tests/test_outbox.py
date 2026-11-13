import pytest

from bot.outbox import run_outbox
from tests.test_sender import FakeTelegram


@pytest.fixture
async def world(pool):
    await pool.execute("TRUNCATE outbox, send_logs, schedule_items, templates, chats RESTART IDENTITY CASCADE")
    await pool.execute("INSERT INTO chats (telegram_id, title) VALUES (-1001, 'ПВЗ 1'), (-1002, 'ПВЗ 2')")
    await pool.execute(
        "INSERT INTO templates (name, kind, text, options) VALUES ('Смена', 'poll', 'Смена открыта?', '{Да,Нет}')"
    )
    return pool


async def jobs(db):
    rows = await db.fetch(
        "SELECT c.telegram_id, l.status::text, l.message_id, l.poll_id, l.error, l.template_id FROM outbox o "
        "JOIN chats c ON c.id = o.chat_id LEFT JOIN send_logs l ON l.outbox_id = o.id ORDER BY o.id"
    )
    return [tuple(r) for r in rows]


async def test_sends_template_and_custom_text_and_logs_them(world):
    await world.execute(
        "INSERT INTO outbox (chat_id, template_id, text) VALUES (1, 1, NULL), (2, NULL, 'Сегодня короткий день')"
    )
    tg = FakeTelegram()
    await run_outbox(world, tg)
    assert [(m, k["chat_id"]) for m, k in tg.calls] == [("sendPoll", -1001), ("sendMessage", -1002)]
    assert tg.calls[1][1]["text"] == "Сегодня короткий день"
    assert await jobs(world) == [(-1001, "sent", 101, "poll-1", None, 1), (-1002, "sent", 102, None, None, None)]


async def test_a_job_runs_exactly_once_even_across_restarts(world):
    await world.execute("INSERT INTO outbox (chat_id, text) VALUES (1, 'раз')")
    await run_outbox(world, FakeTelegram())
    tg = FakeTelegram()  # bot restarted
    await run_outbox(world, tg)
    assert tg.calls == []
    assert len(await jobs(world)) == 1


async def test_claimed_but_unfinished_job_is_not_resent(world):
    await world.execute("INSERT INTO outbox (chat_id, text) VALUES (1, 'раз')")
    await world.execute("INSERT INTO send_logs (chat_id, slot, outbox_id) VALUES (1, now(), 1)")  # crashed mid-send
    tg = FakeTelegram()
    await run_outbox(world, tg)
    assert tg.calls == []


async def test_telegram_error_is_logged_and_other_jobs_still_go_out(world):
    await world.execute("INSERT INTO outbox (chat_id, text) VALUES (1, 'a'), (2, 'b')")
    tg = FakeTelegram(fail_for={-1001})
    await run_outbox(world, tg)
    rows = await jobs(world)
    assert rows[0][:2] == (-1001, "error") and "bot was kicked" in rows[0][4]
    assert rows[1][:2] == (-1002, "sent")


async def test_job_whose_template_was_deleted_is_an_error(world):
    await world.execute("INSERT INTO outbox (chat_id, template_id) VALUES (1, 1)")
    await world.execute("DELETE FROM templates")
    tg = FakeTelegram()
    await run_outbox(world, tg)
    assert tg.calls == []
    assert (await jobs(world))[0][1] == "error"


async def test_mention_failure_is_recorded_but_the_job_stays_sent(world):
    await world.execute("UPDATE templates SET mention_all = true")
    await world.execute("INSERT INTO outbox (chat_id, template_id) VALUES (1, 1)")
    tg = FakeTelegram()
    await run_outbox(world, tg)  # no user client configured, so the mention step fails
    [row] = await jobs(world)
    assert row[1] == "sent" and row[4]


async def test_poll_sent_from_the_outbox_snapshots_chat_members(world):
    from tests.test_sender import FakeUser

    await world.execute("TRUNCATE poll_members")
    await world.execute("INSERT INTO outbox (chat_id, template_id) VALUES (1, 1)")
    await run_outbox(world, FakeTelegram(), FakeUser())
    rows = await world.fetch("SELECT poll_id, user_id FROM poll_members ORDER BY user_id")
    assert [tuple(r) for r in rows] == [("poll-1", 5), ("poll-1", 6)]
