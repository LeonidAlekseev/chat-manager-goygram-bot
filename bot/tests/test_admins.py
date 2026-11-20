import pytest

from bot.admins import check_due, status_of
from bot.link import handle_link_start


class FakeBot:
    """getChatMember per (chat, user): a dict answer, or an exception to raise."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    async def bot_req(self, method, **kw):
        assert method == "getChatMember"
        self.calls.append((kw["chat_id"], kw["user_id"]))
        a = self.answers[(kw["chat_id"], kw["user_id"])]
        if isinstance(a, Exception):
            raise a
        return a


@pytest.mark.parametrize(
    ("member", "status"),
    [
        ({"status": "creator"}, "admin"),
        ({"status": "administrator"}, "admin"),
        ({"status": "member"}, "member"),
        ({"status": "restricted", "is_member": True}, "member"),
        ({"status": "restricted", "is_member": False}, "absent"),
        ({"status": "left"}, "absent"),
        ({"status": "kicked"}, "absent"),
        ({"result": {"status": "administrator"}}, "admin"),  # bot_req may not unwrap "result"
    ],
)
async def test_member_status(member, status):
    assert await status_of(FakeBot({(1, 2): member}), 1, 2) == status


async def test_unknown_user_is_absent_and_other_errors_unknown():
    # the text GoyGram 0.8.29 raises (transports/botapi.py req): the Bot API response dict after the status
    def http_error(code, description):
        raw = {"ok": False, "error_code": code, "description": description}
        return RuntimeError(f"botapi getChatMember http {code}: {raw}")

    bot = FakeBot({
        (1, 2): http_error(400, "Bad Request: user not found"),
        (1, 3): http_error(400, "Bad Request: PARTICIPANT_ID_INVALID"),
        (1, 4): http_error(403, "Forbidden: bot was kicked from the supergroup chat"),
        (1, 5): http_error(400, "Bad Request: chat not found"),
        (1, 6): TimeoutError(),
    })
    assert [await status_of(bot, 1, u) for u in (2, 3, 4, 5, 6)] == ["absent", "absent", "unknown", "unknown", "unknown"]


async def setup(db):
    await db.execute("TRUNCATE managers CASCADE")
    ids = {}
    for login, tg in (("linked", 42), ("unlinked", None)):
        ids[login] = await db.fetchval(
            "INSERT INTO managers (login, password_hash, telegram_user_id, link_code, link_code_expires_at) "
            "VALUES ($1, 'x', $2, $1, now() + interval '15 minutes') RETURNING id", login, tg)
    for tid, active, deleting in ((-1001, True, False), (-1002, False, False), (-1003, True, True), (-1004, True, False)):
        ids[tid] = await db.fetchval(
            "INSERT INTO chats (telegram_id, title, active, deleting) VALUES ($1, 't', $2, $3) RETURNING id",
            tid, active, deleting)
        for m in ("linked", "unlinked"):
            await db.execute("INSERT INTO chat_managers (chat_id, manager_id) VALUES ($1, $2)", ids[tid], ids[m])
    return ids


async def statuses(db, manager_id):
    rows = await db.fetch(
        "SELECT c.telegram_id, cm.member_status FROM chat_managers cm JOIN chats c ON c.id = cm.chat_id "
        "WHERE cm.manager_id = $1 ORDER BY c.telegram_id DESC", manager_id)
    return {r["telegram_id"]: r["member_status"] for r in rows}


async def test_checks_linked_managers_in_live_chats_once_a_day(db):
    ids = await setup(db)
    bot = FakeBot({(-1001, 42): {"status": "member"}, (-1004, 42): {"status": "creator"}})
    await check_due(db, bot, pause=0)
    # an unlinked manager, a chat the bot left and a deleting chat are not asked about
    assert sorted(bot.calls) == [(-1004, 42), (-1001, 42)]
    assert await statuses(db, ids["linked"]) == {-1001: "member", -1002: None, -1003: None, -1004: "admin"}
    assert set((await statuses(db, ids["unlinked"])).values()) == {None}
    await check_due(db, bot, pause=0)
    assert len(bot.calls) == 2  # checked within the day
    await db.execute("UPDATE chat_managers SET checked_at = now() - interval '25 hours' WHERE chat_id = $1", ids[-1001])
    await check_due(db, bot, pause=0)
    assert bot.calls[2:] == [(-1001, 42)]


async def test_a_batch_is_limited(db):
    await setup(db)
    bot = FakeBot({(-1001, 42): {"status": "member"}, (-1004, 42): {"status": "member"}})
    await check_due(db, bot, pause=0, batch=1)
    assert len(bot.calls) == 1


async def test_linking_telegram_queues_a_recheck(db):
    ids = await setup(db)
    await db.execute("UPDATE chat_managers SET member_status = 'admin', checked_at = now()")
    message = {"chat": {"id": 7, "type": "private"}, "from": {"id": 7}, "text": "/start link_unlinked"}
    await handle_link_start(db, message)
    bot = FakeBot({(-1001, 7): {"status": "left"}, (-1004, 7): {"status": "member"}})
    await check_due(db, bot, pause=0)
    assert await statuses(db, ids["unlinked"]) == {-1001: "absent", -1002: None, -1003: None, -1004: "member"}
    assert set((await statuses(db, ids["linked"])).values()) == {"admin"}


async def test_a_relink_during_the_check_keeps_the_new_account_due(db):
    ids = await setup(db)

    class Relinking(FakeBot):
        async def bot_req(self, method, **kw):
            await db.execute("UPDATE managers SET telegram_user_id = 99 WHERE id = $1", ids["linked"])
            return {"status": "member"}

    await check_due(db, Relinking({}), pause=0, batch=1)
    assert await db.fetchval("SELECT count(*) FROM chat_managers WHERE checked_at IS NOT NULL") == 0


async def test_a_failed_check_keeps_the_last_status_and_is_retried_within_hours(db):
    ids = await setup(db)
    await db.execute("UPDATE chat_managers SET member_status = 'member', checked_at = now() - interval '2 days'")
    bot = FakeBot({(-1001, 42): TimeoutError(), (-1004, 42): {"status": "administrator"}})
    await check_due(db, bot, pause=0)
    assert (await statuses(db, ids["linked"]))[-1001] == "member"  # a 429 or timeout does not hide the badge
    assert await db.fetchval(
        "SELECT checked_at < now() - interval '22 hours' AND checked_at > now() - interval '1 day' "
        "FROM chat_managers WHERE chat_id = $1 AND manager_id = $2", ids[-1001], ids["linked"])
    await check_due(db, bot, pause=0)
    assert len(bot.calls) == 2  # not again at once
    await db.execute("UPDATE chat_managers SET checked_at = checked_at - interval '2 hours' WHERE chat_id = $1", ids[-1001])
    await check_due(db, bot, pause=0)
    assert bot.calls[2:] == [(-1001, 42)]


async def test_a_pair_never_checked_that_fails_is_unknown(db):
    ids = await setup(db)
    await check_due(db, FakeBot({(-1001, 42): TimeoutError(), (-1004, 42): TimeoutError()}), pause=0)
    assert (await statuses(db, ids["linked"]))[-1001] == "unknown"
