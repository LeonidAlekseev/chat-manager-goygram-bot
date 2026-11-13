import asyncio
import json
import os
import re
import stat

import pytest
from goygram.errors import rpc_error

import bot.account
from bot.account import Account, GoyGramLogin, MembersClient, open_client
from bot.mention import NO_SESSION, MentionError, fetch_user_ids
from bot.settings import decrypt, encrypt

SECRET = "bot-test-secret"
USER = {"id": 42, "first_name": "Анна", "username": "anna"}
PAYLOAD = {"auth_key": "ab" * 256, "dc": 2, "user": USER}


class FakeLogin:
    """Stands in for a fresh MTProto client during login (see bot.account.GoyGramLogin)."""

    def __init__(self, api_id, api_hash):
        self.api = (api_id, api_hash)
        self.calls = []
        self.closed = False
        self.errors = {}

    async def send_code(self, phone):
        self.calls.append(("send_code", phone))
        return "hash-1"

    async def sign_in(self, phone, code_hash, code):
        self.calls.append(("sign_in", phone, code_hash, code))
        if code in self.errors:
            raise rpc_error(400, self.errors[code])
        return PAYLOAD

    async def check_password(self, password):
        self.calls.append(("check_password", password))
        if password != "secret":
            raise rpc_error(400, "PASSWORD_HASH_INVALID")
        return PAYLOAD

    async def close(self):
        self.closed = True


@pytest.fixture
async def adb(pool):
    await pool.execute("TRUNCATE settings, mtproto_login")
    await pool.execute("INSERT INTO settings (id, api_id, api_hash) VALUES (1, 2040, $1)", encrypt("hash", SECRET))
    return pool


class FakeClient:
    """Stands in for the logged-in GoyGram user client."""

    def __init__(self, api_id, api_hash, session):
        self.args = (api_id, api_hash, session)
        self.running = False
        self.ended = False
        self.end_error = None

    async def end_session(self):
        if self.end_error:
            raise self.end_error
        self.ended = True

    async def run(self):
        self.running = True
        try:
            await asyncio.Event().wait()
        finally:
            self.running = False

    async def iter_participants(self, chat_id):
        for uid in (1, 2):
            yield {"user_id": uid}


@pytest.fixture
def logins():
    return []


@pytest.fixture
def clients():
    return []


@pytest.fixture
async def account(adb, logins, clients):
    async def connect(api_id, api_hash):
        logins.append(FakeLogin(api_id, api_hash))
        return logins[-1]

    async def open_client(api_id, api_hash, session):
        clients.append(FakeClient(api_id, api_hash, session))
        return clients[-1]

    a = Account(adb, SECRET, connect=connect, open_client=open_client)
    yield a
    await a.stop()


async def ask(db, step, value):
    await db.execute(
        "INSERT INTO mtproto_login (id, step, input) VALUES (1, $1, $2) "
        "ON CONFLICT (id) DO UPDATE SET step = $1, input = $2, error = NULL",
        step, encrypt(value, SECRET),
    )


async def login_row(db):
    return dict(await db.fetchrow("SELECT step, input, state, error FROM mtproto_login"))


async def test_phone_step_sends_the_code_and_waits_for_it(adb, account, logins):
    await ask(adb, "phone", "+79990001122")
    await account.tick()
    assert logins[0].api == (2040, "hash")
    assert logins[0].calls == [("send_code", "+79990001122")]
    assert await login_row(adb) == {"step": None, "input": None, "state": "code", "error": None}


async def test_code_step_signs_in_and_stores_the_session_encrypted(adb, account, logins):
    await ask(adb, "phone", "+79990001122")
    await account.tick()
    await ask(adb, "code", "12345")
    await account.tick()
    assert logins[0].calls[1] == ("sign_in", "+79990001122", "hash-1", "12345")
    assert logins[0].closed
    row = await adb.fetchrow("SELECT api_session, api_account FROM settings")
    assert "auth_key" not in row["api_session"]
    assert json.loads(decrypt(row["api_session"], SECRET)) == PAYLOAD
    assert row["api_account"] == "Анна (@anna)"
    assert await login_row(adb) == {"step": None, "input": None, "state": None, "error": None}


async def send_code(db, account):
    await ask(db, "phone", "+79990001122")
    await account.tick()


async def test_two_factor_password_completes_the_login(adb, account, logins):
    await send_code(adb, account)
    logins[0].errors["12345"] = "SESSION_PASSWORD_NEEDED"
    await ask(adb, "code", "12345")
    await account.tick()
    assert await login_row(adb) == {"step": None, "input": None, "state": "password", "error": None}
    await ask(adb, "password", "secret")
    await account.tick()
    assert logins[0].calls[-1] == ("check_password", "secret")
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"
    assert (await login_row(adb))["state"] is None


async def test_wrong_code_asks_for_it_again(adb, account, logins):
    await send_code(adb, account)
    logins[0].errors["111"] = "PHONE_CODE_INVALID"
    await ask(adb, "code", "111")
    await account.tick()
    assert await login_row(adb) == {"step": None, "input": None, "state": "code", "error": "Неверный код."}
    await ask(adb, "code", "12345")
    await account.tick()
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"


async def test_wrong_password_asks_for_it_again(adb, account, logins):
    await send_code(adb, account)
    logins[0].errors["12345"] = "SESSION_PASSWORD_NEEDED"
    await ask(adb, "code", "12345")
    await account.tick()
    await ask(adb, "password", "nope")
    await account.tick()
    assert await login_row(adb) == {"step": None, "input": None, "state": "password", "error": "Неверный пароль."}


@pytest.mark.parametrize(
    "rpc, error",
    [
        ("PHONE_CODE_EXPIRED", "Код просрочен, запросите новый."),
        ("FLOOD_WAIT_120", "Telegram ограничил попытки входа: повторите через 120 с."),
        ("API_ID_INVALID", "Неверные API ID или API HASH: проверьте их на my.telegram.org."),
    ],
)
async def test_expired_code_or_flood_limit_starts_over(adb, account, logins, rpc, error):
    await send_code(adb, account)
    logins[0].errors["12345"] = rpc
    await ask(adb, "code", "12345")
    await account.tick()
    assert await login_row(adb) == {"step": None, "input": None, "state": None, "error": error}
    assert logins[0].closed
    assert await adb.fetchval("SELECT api_session FROM settings") is None


async def test_a_code_without_a_pending_login_starts_over(adb, account):
    await ask(adb, "code", "12345")  # e.g. the bot restarted after sending the code
    await account.tick()
    assert await login_row(adb) == {
        "step": None, "input": None, "state": None, "error": "Вход прерван, запросите код заново.",
    }


async def test_flood_limit_on_sending_the_code(adb, account, logins):
    async def flood(phone):
        raise rpc_error(420, "FLOOD_WAIT_30")

    await ask(adb, "phone", "+79990001122")
    account.connect = lambda *a: _with(FakeLogin(*a), send_code=flood)
    await account.tick()
    assert await login_row(adb) == {
        "step": None, "input": None, "state": None,
        "error": "Telegram ограничил попытки входа: повторите через 30 с.",
    }


async def _with(login, **methods):
    for k, v in methods.items():
        setattr(login, k, v)
    return login


async def test_a_network_failure_is_reported_and_starts_over(adb, account):
    async def down(*a):
        raise TimeoutError()

    account.connect = down
    await ask(adb, "phone", "+79990001122")
    await account.tick()
    assert await login_row(adb) == {"step": None, "input": None, "state": None, "error": "Ошибка Telegram: TimeoutError"}


async def test_without_a_session_member_lists_explain_how_to_log_in(adb, account):
    await account.tick()
    with pytest.raises(MentionError, match=re.escape(NO_SESSION)):
        await fetch_user_ids(account, -100)
    assert "войдите" in NO_SESSION


async def test_login_starts_the_user_client_without_a_restart(adb, account, clients):
    await send_code(adb, account)
    await ask(adb, "code", "12345")
    await account.tick()
    await asyncio.sleep(0)
    assert clients[0].args == (2040, "hash", PAYLOAD) and clients[0].running
    assert await fetch_user_ids(account, -100) == [1, 2]
    await account.tick()
    assert len(clients) == 1  # same session: keeps the running client


async def logged_in(db, account):
    await db.execute(
        "UPDATE settings SET api_session = $1, api_account = 'Анна (@anna)'", encrypt(json.dumps(PAYLOAD), SECRET))
    await account.tick()
    await asyncio.sleep(0)


async def test_stored_session_starts_the_client_and_logout_stops_it(adb, account, clients):
    await logged_in(adb, account)
    assert clients[0].running
    await ask(adb, "logout", "")  # the panel's «Выйти»
    await account.tick()
    assert clients[0].ended and not clients[0].running
    assert tuple(await adb.fetchrow("SELECT api_session, api_account FROM settings")) == (None, None)
    assert await login_row(adb) == {"step": None, "input": None, "state": None, "error": None}
    with pytest.raises(MentionError):
        await fetch_user_ids(account, -100)


async def test_a_failed_telegram_logout_still_wipes_the_session_and_says_so(adb, account, clients):
    await logged_in(adb, account)
    clients[0].end_error = TimeoutError()
    await ask(adb, "logout", "")
    await account.tick()
    assert not clients[0].running
    assert tuple(await adb.fetchrow("SELECT api_session, api_account FROM settings")) == (None, None)
    row = await login_row(adb)
    assert row["step"] is None and "не завершена в Telegram" in row["error"]


async def test_logout_without_a_running_client_wipes_the_session_and_says_so(adb, account):
    await adb.execute("UPDATE settings SET api_session = 'not-decryptable', api_account = 'Анна'")
    await ask(adb, "logout", "")
    await account.tick()
    assert tuple(await adb.fetchrow("SELECT api_session, api_account FROM settings")) == (None, None)
    assert "не завершена в Telegram" in (await login_row(adb))["error"]


async def test_an_undecryptable_step_is_reported_not_left_pending(adb, account):
    await adb.execute("INSERT INTO mtproto_login (id, step, input) VALUES (1, 'phone', 'garbage')")
    await account.tick()
    row = await login_row(adb)
    assert (row["step"], row["input"], row["state"]) == (None, None, None) and row["error"]


async def test_tick_marks_the_bot_alive(adb, account):
    await account.tick()
    assert await adb.fetchval("SELECT now() - bot_seen_at < interval '5 seconds' FROM settings")


class FakeApp:
    """The slice of a GoyGram app that GoyGramLogin touches."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []
        self.mt = type("Mt", (), {"auth_key": b"\x01" * 4, "server_salt": b"\x02" * 2})()

    async def mt_req(self, act, **kw):
        self.calls.append((act, kw))
        return self.answers[act]


async def test_goygram_login_turns_error_answers_into_rpc_errors():
    app = FakeApp({"auth_sign_in": {"error_message": "PHONE_CODE_INVALID"}})
    with pytest.raises(Exception, match="PHONE_CODE_INVALID"):
        await GoyGramLogin(app).sign_in("+7999", "h", "1")
    assert app.calls[0][1]["retry"] == 0  # a flood wait reaches the panel instead of a silent sleep


async def test_goygram_login_builds_the_vault_payload():
    app = FakeApp({"auth_check_password": {"user": USER, "dc_id": 4}})
    assert await GoyGramLogin(app).check_password("secret") == {
        "user": USER, "auth_key": "01010101", "server_salt": "0202", "dc": 4,
    }


async def test_the_step_stays_pending_until_the_bot_answers(adb, account, logins):
    seen = []

    async def slow_send_code(phone):
        seen.append(await login_row(adb))  # what the panel sees while Telegram is being asked
        return "hash-1"

    async def connect(*a):
        return await _with(FakeLogin(*a), send_code=slow_send_code)

    account.connect = connect
    await ask(adb, "phone", "+79990001122")
    await account.tick()
    assert seen == [{"step": "phone", "input": None, "state": None, "error": None}]
    assert await login_row(adb) == {"step": None, "input": None, "state": "code", "error": None}


async def test_a_failed_client_start_is_retried(adb, account, clients):
    real, fails = account.open_client, [ConnectionError("dc probe failed")]

    async def flaky(*a):
        if fails:
            raise fails.pop()
        return await real(*a)

    account.open_client = flaky
    await adb.execute("UPDATE settings SET api_session = $1", encrypt(json.dumps(PAYLOAD), SECRET))
    with pytest.raises(ConnectionError):
        await account.tick()
    await account.tick()
    assert len(clients) == 1


class FakeMembers:
    def __init__(self, **kw):
        self.kw = kw


async def test_the_vault_is_a_private_directory_per_client(monkeypatch):
    monkeypatch.setattr(bot.account, "MembersClient", FakeMembers)
    a, b = await open_client(2040, "hash", PAYLOAD), await open_client(2040, "hash", PAYLOAD)
    try:
        assert a.vault != b.vault and a.vault.is_file()
        assert stat.S_IMODE(os.stat(a.vault.parent).st_mode) == 0o700
        assert a.kw["session"].path == a.vault
    finally:
        for c in (a, b):
            c.vault.unlink()
            c.vault.parent.rmdir()


async def test_the_vault_is_deleted_when_the_client_stops(monkeypatch):
    monkeypatch.setattr(bot.account, "MembersClient", FakeMembers)
    client = await open_client(2040, "hash", PAYLOAD)

    async def done(self):
        pass

    monkeypatch.setattr(bot.account.GoyGram, "run", done)
    members = MembersClient.__new__(MembersClient)
    members.vault = client.vault
    await members.run()
    assert not client.vault.parent.exists()


async def test_a_failed_client_start_leaves_no_vault(monkeypatch):
    made = []

    def broken(**kw):
        made.append(kw["session"].path)
        raise ConnectionError("dc probe failed")

    monkeypatch.setattr(bot.account, "MembersClient", broken)
    with pytest.raises(ConnectionError):
        await open_client(2040, "hash", PAYLOAD)
    assert not made[0].parent.exists()
