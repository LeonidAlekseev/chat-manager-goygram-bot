from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from bot.scheduler import run_due

MSK = ZoneInfo("Europe/Moscow")
NOW = datetime(2026, 3, 2, 8, 0, tzinfo=MSK)


class FakeTelegram:
    def __init__(self, fail_for: set[int] = frozenset()):
        self.calls: list[tuple[str, dict]] = []
        self.fail_for = fail_for

    async def bot_req(self, meth: str, **kw):
        if kw["chat_id"] in self.fail_for:
            raise RuntimeError("botapi sendPoll fail: Forbidden: bot was kicked")
        self.calls.append((meth, kw))
        msg = {"message_id": 100 + len(self.calls), "chat": {"id": kw["chat_id"]}}
        if meth == "sendPoll":
            msg["poll"] = {"id": f"poll-{len(self.calls)}"}
        return msg


@pytest.fixture
async def world(pool):
    await pool.execute("TRUNCATE send_logs, schedule_items, schedules, templates, chats RESTART IDENTITY CASCADE")
    poll = await pool.fetchval(
        "INSERT INTO templates (name, kind, text, options, anonymous, multiple) "
        "VALUES ('Смена', 'poll', 'Смена открыта?', '{Да,Нет}', false, true) RETURNING id"
    )
    note = await pool.fetchval(
        "INSERT INTO templates (name, kind, text) VALUES ('Ключ', 'text', 'Не забудьте ключ') RETURNING id"
    )
    sid = await pool.fetchval("INSERT INTO schedules (name) VALUES ('Смена 08:00') RETURNING id")
    other = await pool.fetchval("INSERT INTO schedules (name) VALUES ('Смена 09:00') RETURNING id")
    await pool.executemany(
        "INSERT INTO schedule_items (schedule_id, template_id, time, start_date, period) VALUES ($1, $2, $3, $4, $5)",
        [
            (sid, poll, "08:00", date(2026, 3, 1), "day"),
            (sid, note, "08:00", date(2026, 3, 1), "week"),  # not due on Mar 2
            (sid, note, "09:00", date(2026, 3, 1), "day"),  # other minute
            (other, note, "08:00", date(2026, 3, 1), "day"),
        ],
    )
    await pool.executemany(
        "INSERT INTO chats (telegram_id, title, active, schedule_id) VALUES ($1, $2, $3, $4)",
        [(-1001, "ПВЗ 1", True, sid), (-1002, "ПВЗ 2", True, sid), (-1003, "Удалён", False, sid),
         (-1004, "Без расписания", True, None), (-1005, "ПВЗ 9", True, other)],
    )
    return pool


async def logs(db):
    rows = await db.fetch(
        "SELECT c.telegram_id, l.status::text, l.message_id, l.poll_id, l.error FROM send_logs l "
        "JOIN chats c ON c.id = l.chat_id ORDER BY c.telegram_id DESC"
    )
    return [tuple(r) for r in rows]


async def test_sends_due_items_to_bound_active_chats_and_logs_them(world):
    tg = FakeTelegram()
    await run_due(world, tg, NOW)
    assert tg.calls == [
        ("sendPoll", {"chat_id": -1001, "question": "Смена открыта?", "options": [{"text": "Да"}, {"text": "Нет"}],
                      "is_anonymous": False, "allows_multiple_answers": True}),
        ("sendPoll", {"chat_id": -1002, "question": "Смена открыта?", "options": [{"text": "Да"}, {"text": "Нет"}],
                      "is_anonymous": False, "allows_multiple_answers": True}),
        ("sendMessage", {"chat_id": -1005, "text": "Не забудьте ключ"}),
    ]
    assert await logs(world) == [
        (-1001, "sent", 101, "poll-1", None),
        (-1002, "sent", 102, "poll-2", None),
        (-1005, "sent", 103, None, None),
    ]


async def test_rerun_in_the_same_minute_sends_nothing_again(world):
    await run_due(world, FakeTelegram(), NOW)
    tg = FakeTelegram()  # e.g. the bot restarted
    await run_due(world, tg, NOW.replace(second=40))
    assert tg.calls == []
    assert len(await logs(world)) == 3


async def test_next_day_is_a_new_slot(world):
    await run_due(world, FakeTelegram(), NOW)
    tg = FakeTelegram()
    await run_due(world, tg, NOW.replace(day=3))
    assert len(tg.calls) == 3


async def test_telegram_error_is_logged_and_others_still_go_out(world):
    tg = FakeTelegram(fail_for={-1001})
    await run_due(world, tg, NOW)
    assert [c[1]["chat_id"] for c in tg.calls] == [-1002, -1005]
    first = (await logs(world))[0]
    assert first[:2] == (-1001, "error") and "bot was kicked" in first[4]


async def test_mention_failure_keeps_status_sent_and_records_error(world):
    await world.execute("UPDATE templates SET mention_all = true WHERE kind = 'poll'")
    await run_due(world, FakeTelegram(), NOW)  # no user session
    first = (await logs(world))[0]
    assert first[1] == "sent" and first[2] == 101 and "API_ID" in first[4]
