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
    with pytest.raises(MentionError, match="API_ID"):
        await mention_all(FakeBot(), None, -100, "hi")


async def test_mention_all_basic_group_gives_clear_error():
    with pytest.raises(MentionError, match="супергруп"):
        await mention_all(FakeBot(), FakeUser(exc=ValueError("x")), -5, "hi")


def message(text, user=7, reply=None):
    m = {"message_id": 9, "chat": {"id": -100, "type": "supergroup"}, "from": {"id": user}, "text": text}
    if reply:
        m["reply_to_message"] = {"message_id": reply}
    return m


async def test_handle_all_admin_with_text_and_reply():
    bot = FakeBot("creator")
    await handle_all(bot, FakeUser([{"user_id": 1}]), message("/all@b Внимание", reply=3))
    [s] = bot.sent()
    assert s["text"].startswith("Внимание") and s["reply_parameters"] == {"message_id": 3}


async def test_handle_all_denies_non_admin():
    bot = FakeBot("member")
    await handle_all(bot, FakeUser([{"user_id": 1}]), message("/all"))
    [s] = bot.sent()
    assert "администратор" in s["text"] and "tg://" not in s["text"]


async def test_handle_all_reports_error_in_chat():
    bot = FakeBot()
    await handle_all(bot, None, message("/all"))
    assert "API_ID" in bot.sent()[0]["text"]


async def test_handle_all_ignores_other_commands_and_private():
    bot = FakeBot()
    await handle_all(bot, None, message("/chatid"))
    await handle_all(bot, None, {**message("/all"), "chat": {"id": 1, "type": "private"}})
    assert bot.calls == []
