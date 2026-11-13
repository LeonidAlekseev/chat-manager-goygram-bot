from bot.sender import send_template

POLL = {"kind": "poll", "text": "Q", "options": ["a"], "anonymous": False, "multiple": False, "mention_all": True}
TEXT = {"kind": "text", "text": "Привет", "options": [], "anonymous": False, "multiple": False, "mention_all": True}


class Tg:
    def __init__(self, fail_on=None):
        self.calls, self.fail_on = [], fail_on

    async def bot_req(self, meth, **kw):
        if meth == self.fail_on:
            raise RuntimeError("boom")
        self.calls.append((meth, kw))
        return {"message_id": len(self.calls), "poll": {"id": "p"}} if meth == "sendPoll" else {"message_id": len(self.calls)}


class User:
    async def iter_participants(self, chat_id):
        yield {"user_id": 5}


async def test_poll_is_followed_by_separate_mention_message():
    tg = Tg()
    msg = await send_template(tg, -1, POLL, User())
    assert [c[0] for c in tg.calls] == ["sendPoll", "sendMessage"]
    assert "tg://user?id=5" in tg.calls[1][1]["text"] and msg["message_id"] == 1


async def test_text_template_mentions_in_the_same_message():
    tg = Tg()
    await send_template(tg, -1, TEXT, User())
    assert [c[0] for c in tg.calls] == ["sendMessage"]
    assert tg.calls[0][1]["text"].startswith("Привет") and "tg://user?id=5" in tg.calls[0][1]["text"]


async def test_no_mention_without_flag():
    tg = Tg()
    await send_template(tg, -1, {**POLL, "mention_all": False}, User())
    assert [c[0] for c in tg.calls] == ["sendPoll"]


async def test_mention_failure_keeps_main_send_and_reports_error():
    tg = Tg(fail_on="sendMessage")
    msg = await send_template(tg, -1, POLL, User())
    assert msg["message_id"] == 1 and "boom" in msg["mention_error"]


async def test_missing_session_reports_error_but_poll_is_sent():
    tg = Tg()
    msg = await send_template(tg, -1, POLL)
    assert [c[0] for c in tg.calls] == ["sendPoll"] and "API_ID" in msg["mention_error"]
