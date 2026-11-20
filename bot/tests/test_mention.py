import asyncio

import pytest

from bot.mention import MentionError, build_mention_messages, handle_all, mention_all


def test_short_text_one_message_with_hidden_links():
    [m] = build_mention_messages("Привет <все>", [1, 2])
    assert m == 'Привет &lt;все&gt;<a href="tg://user?id=1">&#8205;</a><a href="tg://user?id=2">&#8205;</a>'


def test_split_by_entity_limit_and_each_chunk_keeps_text():
    msgs = build_mention_messages("hi", list(range(1, 251)))
    assert [m.count("tg://") for m in msgs] == [100, 100, 50]
    assert all(m.startswith("hi") for m in msgs)


def test_split_by_text_length_limit():
    # visible length = text + one char per mention must stay <= 4096
    msgs = build_mention_messages("x" * 4046, list(range(1, 101)))
    assert [m.count("tg://") for m in msgs] == [50, 50]


def test_text_too_long_to_mention_anyone():
    with pytest.raises(MentionError):
        build_mention_messages("x" * 4096, [1])


def test_no_users_sends_nothing():
    assert build_mention_messages("hi", []) == []


class FakeUser:
    def __init__(self, items=None, exc=None):
        self.items, self.exc = items or [], exc

    async def iter_participants(self, chat_id):
        if self.exc:
            raise self.exc
        for i in self.items:
            yield i


class FakeBot:
    def __init__(self, status="administrator"):
        self.status, self.calls = status, []

    async def bot_req(self, method, **kw):
        self.calls.append((method, kw))
        if method == "getChatMember":
            return {"status": self.status}
        return {}

    def sent(self):
        return [kw for m, kw in self.calls if m == "sendMessage"]


async def test_mention_all_sends_default_text():
    bot = FakeBot()
    user = FakeUser([{"user_id": 1}, {"user_id": 2}])
    await mention_all(bot, user, -100, None)
    [s] = bot.sent()
    assert s["chat_id"] == -100 and s["parse_mode"] == "HTML" and s["text"].startswith("Сообщение для всех")
    assert s["text"].count("tg://") == 2


async def test_mention_all_without_user_client():
    with pytest.raises(MentionError, match="Не выполнен вход"):
        await mention_all(FakeBot(), None, -100, "hi")


async def test_mention_all_basic_group_gives_clear_error():
    with pytest.raises(MentionError, match="супергруп"):
        await mention_all(FakeBot(), FakeUser(exc=ValueError("x")), -5, "hi")


def message(text, user=7, reply=None):
    m = {"message_id": 9, "chat": {"id": -100, "type": "supergroup"}, "from": {"id": user}, "text": text}
    if reply:
        m["reply_to_message"] = {"message_id": reply}
    return m


async def run_all(db, bot, user, msg):
    await (await handle_all(db, bot, user, msg))


async def test_handle_all_admin_with_text_and_reply(db):
    bot = FakeBot("creator")
    await run_all(db, bot, FakeUser([{"user_id": 1}]), message("/all@b Внимание", reply=3))
    [s] = bot.sent()
    assert s["text"].startswith("Внимание") and s["reply_parameters"] == {"message_id": 3}


async def test_handle_all_denies_non_admin(db):
    bot = FakeBot("member")
    await run_all(db, bot, FakeUser([{"user_id": 1}]), message("/all"))
    [s] = bot.sent()
    assert s["text"] == "Команда доступна администраторам чата и менеджерам панели." and "tg://" not in s["text"]


async def test_handle_all_reports_error_in_chat(db):
    bot = FakeBot()
    await run_all(db, bot, None, message("/all"))
    assert "Не выполнен вход" in bot.sent()[0]["text"]


async def test_handle_all_ignores_other_commands_and_private(db):
    bot = FakeBot()
    assert await handle_all(db, bot, None, message("/chatid")) is None
    assert await handle_all(db, bot, None, {**message("/all"), "chat": {"id": 1, "type": "private"}}) is None
    assert bot.calls == []


class SlowUser:
    def __init__(self):
        self.go = asyncio.Event()

    async def iter_participants(self, chat_id):
        await self.go.wait()
        raise ConnectionError("MTProto connection lost")
        yield


async def test_handle_all_returns_at_once_and_reports_a_failure_in_chat(db):
    bot, user = FakeBot(), SlowUser()
    task = await handle_all(db, bot, user, message("/all"))
    assert not task.done()  # other updates are not held up meanwhile
    assert await handle_all(db, bot, user, message("/all")) is None  # one /all per chat at a time
    user.go.set()
    await task
    [s] = bot.sent()
    assert "Не удалось получить список участников" in s["text"] and "ConnectionError" in s["text"]
    assert await handle_all(db, bot, FakeUser(), message("/all")) is not None  # the chat is free again


async def test_handle_all_gives_up_on_a_hung_member_list(db, monkeypatch):
    monkeypatch.setattr("bot.sender.FETCH_TIMEOUT", 0.01)
    bot = FakeBot()
    await run_all(db, bot, SlowUser(), message("/all"))
    assert "не ответил" in bot.sent()[0]["text"]


async def seed(db):
    """Managers by telegram id: 10 assigned here, 11 assigned elsewhere, 12 inactive and assigned here, 13 superadmin."""
    await db.execute("TRUNCATE managers CASCADE")
    here = await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-100, 't') RETURNING id")
    other = await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-200, 't') RETURNING id")
    for tg, role, active, chat in ((10, "manager", True, here), (11, "manager", True, other),
                                   (12, "manager", False, here), (13, "superadmin", True, None)):
        m = await db.fetchval(
            "INSERT INTO managers (login, password_hash, role, active, telegram_user_id) "
            "VALUES ($1, 'x', $2, $3, $4) RETURNING id", str(tg), role, active, tg)
        if chat:
            await db.execute("INSERT INTO chat_managers (chat_id, manager_id) VALUES ($1, $2)", chat, m)


@pytest.mark.parametrize(("user", "allowed"), [(10, True), (11, False), (12, False), (13, True), (99, False)])
async def test_handle_all_for_panel_managers(db, user, allowed):
    await seed(db)
    bot = FakeBot("member")
    await run_all(db, bot, FakeUser([{"user_id": 1}]), message("/all", user=user))
    [s] = bot.sent()
    assert ("tg://" in s["text"]) == allowed


class RaisingBot(FakeBot):
    async def bot_req(self, method, **kw):
        if method == "getChatMember":
            raise RuntimeError("getChatMember down")
        return await super().bot_req(method, **kw)


async def test_handle_all_assigned_manager_passes_even_if_get_chat_member_fails(db):
    await seed(db)
    bot = RaisingBot()
    await run_all(db, bot, FakeUser([{"user_id": 1}]), message("/all", user=10))
    [s] = bot.sent()
    assert "tg://" in s["text"]
    assert all(m != "getChatMember" for m, _ in bot.calls)
