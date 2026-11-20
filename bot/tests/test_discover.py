from goygram.errors import rpc_error

from bot.discover import NO_ACCOUNT, discover, reset_running
from bot.mention import NO_SESSION, MentionError


class FakeUser:
    """Account.bot_groups over a canned list; `error` is raised after the groups."""

    def __init__(self, groups, error=None):
        self.groups, self.error, self.asked = groups, error, []
        self.restored = True

    def ready(self):
        return self.restored

    async def bot_groups(self, bot_username):
        self.asked.append(bot_username)
        for g in self.groups:
            yield g
        if self.error:
            raise self.error


async def queue(db, state="queued"):
    await db.execute("TRUNCATE chat_discovery, settings")
    await db.execute("INSERT INTO settings (id, bot_username, api_session) VALUES (1, 'pvz_bot', 'cipher')")
    await db.execute("INSERT INTO chat_discovery (id, state) VALUES (1, $1)", state)


async def result(db):
    return tuple(await db.fetchrow("SELECT state, found, added, error FROM chat_discovery"))


async def test_a_queued_scan_adds_the_new_groups_and_reports_the_counts(db):
    await queue(db)
    await db.execute(
        "INSERT INTO chats (telegram_id, title, active, deleting) VALUES (-1001, 'Пункт 1', true, false), "
        "(-1003, 'Удаляется', true, true)"
    )
    user = FakeUser([(-1001, "Из Telegram"), (-1002, "Новая"), (-3, "Обычная"), (-1003, "Удаляется")])
    await discover(db, user)
    assert user.asked == ["pvz_bot"]
    assert await result(db) == ("done", 4, 2, None)
    rows = await db.fetch("SELECT telegram_id, title, active, deleting, schedule_id FROM chats ORDER BY id")
    assert [tuple(r) for r in rows] == [
        (-1001, "Пункт 1", True, False, None),
        (-1003, "Удаляется", True, True, None),  # a chat the panel deletes is not brought back
        (-1002, "Новая", True, False, None),
        (-3, "Обычная", True, False, None),
    ]


async def test_nothing_happens_without_a_queued_scan(db):
    for state in ("done", "running"):
        await queue(db, state)
        user = FakeUser([(-1002, "Новая")])
        await discover(db, user)
        assert user.asked == [] and await db.fetchval("SELECT count(*) FROM chats") == 0


async def test_without_the_account_the_panel_is_told_to_log_in(db):
    await queue(db)
    await db.execute("UPDATE settings SET api_session = NULL")
    user = FakeUser([(-1002, "Новая")])
    user.restored = False
    await discover(db, user)
    assert await result(db) == ("done", 0, 0, NO_ACCOUNT) and user.asked == []
    assert "Настройк" in NO_ACCOUNT


async def test_a_session_ended_mid_scan_asks_to_log_in_again(db):
    await queue(db)
    await discover(db, FakeUser([], MentionError(NO_SESSION)))
    assert await result(db) == ("done", 0, 0, NO_ACCOUNT)


async def test_a_queued_scan_waits_for_the_restored_session(db):
    await queue(db, "running")
    await reset_running(db)  # a restart: the job is queued again, the client is still opening
    user = FakeUser([(-1002, "Новая")])
    user.restored = False
    await discover(db, user)
    assert user.asked == [] and (await result(db))[0] == "queued"
    user.restored = True
    await discover(db, user)
    assert await result(db) == ("done", 1, 1, None)


async def test_a_long_flood_wait_keeps_what_was_found_and_says_when_to_retry(db):
    await queue(db)
    await discover(db, FakeUser([(-1002, "Новая")], rpc_error(420, "FLOOD_WAIT_3600")))
    assert await result(db) == ("done", 1, 1, "Telegram ограничил запросы: повторите через 3600 с.")
    assert await db.fetchval("SELECT count(*) FROM chats") == 1


async def test_any_other_failure_reaches_the_panel(db):
    await queue(db)
    await discover(db, FakeUser([], RuntimeError("Telegram не нашёл бота @pvz_bot")))
    assert await result(db) == ("done", 0, 0, "Ошибка: Telegram не нашёл бота @pvz_bot")


async def test_a_scan_cut_by_a_restart_runs_again(db):
    await queue(db, "running")
    await reset_running(db)
    user = FakeUser([(-1002, "Новая")])
    await discover(db, user)
    assert await result(db) == ("done", 1, 1, None)
