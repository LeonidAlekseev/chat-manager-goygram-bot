import asyncio
import logging

import pytest

from bot.main import redact, start_bot
from bot.settings import encrypt

SECRET = "bot-test-secret"
BAD, GOOD = "111:" + "b" * 35, "222:" + "g" * 35


def test_redacts_bot_tokens_bare_or_in_a_url():
    other = "999:" + "x-_Q" * 9
    out = redact(f"http 401 at https://api.telegram.org/bot{BAD}/getMe, token {BAD}, then bot{other}/x at 12:30")
    assert out == "http 401 at https://api.telegram.org/bot***/getMe, token ***, then bot***/x at 12:30"


class FakeApp:
    def __init__(self, bot_token, **kw):
        self.token, self.calls, self.closed = bot_token, [], False
        self.core = self  # GoyGram keeps close() on app.core

    async def bot_req(self, meth, **kw):
        self.calls.append(meth)
        if self.token == BAD:
            raise RuntimeError(f"botapi getMe http 401 https://api.telegram.org/bot{BAD}/getMe Unauthorized")
        return {"username": "goy_manager_bot"}

    async def close(self):
        self.closed = True


@pytest.fixture
async def sdb(pool):
    await pool.execute("TRUNCATE settings")
    await pool.execute("INSERT INTO settings (id, bot_token) VALUES (1, $1)", encrypt(BAD, SECRET))
    return pool


async def test_a_wrong_token_is_shown_and_the_bot_waits_for_a_new_one(sdb):
    apps = []

    def make_app(bot_token, **kw):
        apps.append(FakeApp(bot_token))
        return apps[-1]

    starting = asyncio.create_task(start_bot(sdb, SECRET, make_app, interval=0.01))
    await asyncio.sleep(0.1)
    assert not starting.done() and len(apps) == 1 and apps[0].closed  # waits instead of crash-looping
    error = await sdb.fetchval("SELECT bot_error FROM settings")
    assert "401" in error and BAD not in error
    await sdb.execute("UPDATE settings SET bot_token = $1", encrypt(GOOD, SECRET))
    settings, app = await asyncio.wait_for(starting, 1)
    assert settings.bot_token == GOOD and app is apps[1]
    assert app.calls == ["getMe", "setMyCommands"]
    assert tuple(await sdb.fetchrow("SELECT bot_error, bot_username FROM settings")) == (None, "goy_manager_bot")


async def test_a_network_failure_on_start_is_not_mistaken_for_a_wrong_token(sdb):
    class Offline(FakeApp):
        async def bot_req(self, meth, **kw):
            raise ConnectionError("api.telegram.org unreachable")

    await sdb.execute("UPDATE settings SET bot_token = $1", encrypt(GOOD, SECRET))
    with pytest.raises(ConnectionError):
        await start_bot(sdb, SECRET, Offline, interval=0.01)


async def test_poll_updates_reach_the_journal_through_goygram(pool):
    # Smoke test of the real GoyGram routing: update -> its norm -> dispatcher -> our handlers.
    from goygram import GoyGram
    from goygram.transports.botapi import BotNet

    from bot.main import register_polls

    await pool.execute("TRUNCATE poll_answers, poll_results")
    app = GoyGram(bot_token=GOOD)
    register_polls(app, pool)
    for upd in (
        {"update_id": 1, "poll": {"id": "p", "options": [{"text": "a", "voter_count": 2}], "is_anonymous": True}},
        {"update_id": 2, "poll_answer": {"poll_id": "p", "user": {"id": 5, "first_name": "A"}, "option_ids": [0]}},
    ):
        await app.core.disp.one({"src": "bot", "data": BotNet.norm(None, upd)})
    assert await pool.fetchval("SELECT counts FROM poll_results WHERE poll_id = 'p'") == [2]
    assert await pool.fetchval("SELECT option_ids FROM poll_answers WHERE poll_id = 'p'") == [0]


async def test_a_token_revoked_while_polling_is_shown_and_the_bot_exits(sdb):
    # GoyGram stops polling quietly on getUpdates 401/404; the process must not keep up its heartbeat.
    from goygram import GoyGram

    from bot.main import _serve
    from bot.settings import load_settings

    await sdb.execute("UPDATE settings SET bot_token = $1", encrypt(GOOD, SECRET))
    app = GoyGram(bot_token=GOOD)

    async def req(meth, data=None):
        if meth == "getUpdates":
            raise RuntimeError(f"botapi getUpdates http 401 https://api.telegram.org/bot{GOOD}/getUpdates")
        return True

    app.core.bot.req = req
    with pytest.raises(RuntimeError, match="Токен бота отклонён Telegram"):
        await asyncio.wait_for(_serve(sdb, SECRET, await load_settings(sdb, SECRET), app), 5)


def test_bot_tokens_are_masked_in_every_log_line_and_traceback(caplog):
    from bot.main import RedactTokens

    logger = logging.getLogger("bot.test")
    caplog.handler.addFilter(RedactTokens())
    try:
        raise RuntimeError(f"botapi sendMessage https://api.telegram.org/bot{GOOD}/sendMessage")
    except RuntimeError:
        logger.exception("send to %s failed via %s", 1, f"bot{GOOD}")
    assert GOOD not in caplog.text and "bot***/sendMessage" in caplog.text
