import asyncio
from datetime import date, datetime
from zoneinfo import ZoneInfo

import asyncpg
import pytest

from bot.scheduler import run_due
from bot.sender import send_template

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


class FakeUser:
    async def iter_participants(self, chat_id):
        yield {"user_id": 5}
        yield {"user_id": 6}


async def test_poll_send_snapshots_chat_members_for_the_answers_page(world):
    await world.execute("TRUNCATE poll_members")
    await run_due(world, FakeTelegram(), NOW, FakeUser())
    rows = await world.fetch("SELECT poll_id, user_id FROM poll_members ORDER BY poll_id, user_id")
    assert [tuple(r) for r in rows] == [("poll-1", 5), ("poll-1", 6), ("poll-2", 5), ("poll-2", 6)]


class FlakyDb:
    """The pool, except that recording a successful send fails once."""

    def __init__(self, pool):
        self.pool, self.failed = pool, False

    def __getattr__(self, name):
        return getattr(self.pool, name)

    async def execute(self, sql, *args):
        if "status = 'sent'" in sql and not self.failed:
            self.failed = True
            raise asyncpg.PostgresError("connection lost")
        return await self.pool.execute(sql, *args)


async def test_db_error_after_a_send_is_logged_and_the_tick_goes_on(world):
    await world.execute("TRUNCATE poll_members")
    tg = FakeTelegram()
    await run_due(FlakyDb(world), tg, NOW, FakeUser())
    assert [c[1]["chat_id"] for c in tg.calls] == [-1001, -1002, -1005]
    assert [r[1] for r in await logs(world)] == ["pending", "sent", "sent"]
    # members are still recorded for the poll whose status update failed
    assert await world.fetchval("SELECT count(*) FROM poll_members WHERE poll_id = 'poll-1'") == 2


class RecordingUser:
    def __init__(self, events):
        self.events = events

    async def iter_participants(self, chat_id):
        self.events.append(("fetch", chat_id))
        yield {"user_id": 5}


async def test_members_are_fetched_only_after_every_send_went_out(world):
    tg = FakeTelegram()
    events: list = tg.calls
    await run_due(world, tg, NOW, RecordingUser(events))
    assert [e[0] for e in events] == ["sendPoll", "sendPoll", "sendMessage", "fetch", "fetch"]


async def test_log_row_keeps_what_was_sent(world):
    await run_due(world, FakeTelegram(), NOW)
    await world.execute("UPDATE templates SET text = 'изменён', options = '{x}'")
    rows = await world.fetch("SELECT text, options FROM send_logs ORDER BY id")
    assert [tuple(r) for r in rows] == [
        ("Смена открыта?", ["Да", "Нет"]), ("Смена открыта?", ["Да", "Нет"]), ("Не забудьте ключ", []),
    ]


class HangingUser:
    async def iter_participants(self, chat_id):
        await asyncio.sleep(3600)
        yield {}


async def test_hung_member_fetches_share_one_budget_so_the_next_tick_is_not_late(world, monkeypatch):
    monkeypatch.setattr("bot.sender.FETCH_TIMEOUT", 0.3)
    monkeypatch.setattr("bot.scheduler.FETCH_TIMEOUT", 0.3)
    start = asyncio.get_running_loop().time()
    await run_due(world, FakeTelegram(), NOW, HangingUser())  # two polls: 0.6 s if fetched one by one
    assert asyncio.get_running_loop().time() - start < 0.5


COPY = {"kind": "copy", "text": "превью", "options": [], "anonymous": False, "multiple": False,
        "mention_all": False, "source_chat_id": 42, "source_message_id": 7}


async def test_copy_is_sent_with_copy_message_and_mentions_follow_separately():
    tg = FakeTelegram()
    msg = await send_template(tg, -1001, {**COPY, "mention_all": True}, FakeUser())
    assert [m for m, _ in tg.calls] == ["copyMessage", "sendMessage"]
    assert tg.calls[0][1] == {"chat_id": -1001, "from_chat_id": 42, "message_id": 7}
    assert tg.calls[1][1]["text"].startswith("Сообщение для всех") and "превью" not in tg.calls[1][1]["text"]
    assert msg["message_id"] == 101


async def test_deleted_source_is_logged_as_an_error(world):
    class Gone(FakeTelegram):
        async def bot_req(self, meth, **kw):
            if meth == "copyMessage":
                raise RuntimeError("botapi copyMessage fail: Bad Request: message to copy not found")
            return await super().bot_req(meth, **kw)

    await world.execute(
        "UPDATE templates SET kind = 'copy', source_chat_id = 42, source_message_id = 7 WHERE name = 'Ключ'")
    await run_due(world, Gone(), NOW)
    row = await world.fetchrow("SELECT status::text, error FROM send_logs WHERE chat_id = 5")
    assert row["status"] == "error" and "message to copy not found" in row["error"]
