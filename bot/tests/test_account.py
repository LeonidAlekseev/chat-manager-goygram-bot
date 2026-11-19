import asyncio
import json
import os
import re
import stat
import time

import pytest
from goygram.errors import RPCError, rpc_error

import bot.account
from bot.account import Account, GoyGramLogin, MembersClient, open_client
from bot.mention import NO_SESSION, MentionError, fetch_users
from bot.settings import decrypt, encrypt

SECRET = "bot-test-secret"
USER = {"id": 42, "first_name": "Анна", "username": "anna"}
PAYLOAD = {"auth_key": "ab" * 256, "dc": 2, "user": USER}
QR = {"url": "tg://login?token=AAAA", "expires": 2**31 - 1}
APP_CODE = {"type": {"_": "auth.sentCodeTypeApp", "length": 5}, "next_type": {"_": "auth.codeTypeSms"}, "timeout": 60}


class FakeLogin:
    """Stands in for a fresh MTProto client during login (see bot.account.GoyGramLogin)."""

    def __init__(self, api_id, api_hash):
        self.api = (api_id, api_hash)
        self.calls = []
        self.closed = False
        self.errors = {}
        self.sent = [APP_CODE]  # what auth.sendCode, then each auth.resendCode answers
        self.qr = [QR]  # what each auth.exportLoginToken answers: a QR link, the session or an RPC error
        self.scan = False  # updateLoginToken arrived

    async def qr_login(self):
        self.calls.append(("qr",))
        res = self.qr.pop(0)
        if isinstance(res, str):
            raise rpc_error(400, res)
        return res

    def scanned(self):
        scan, self.scan = self.scan, False
        return scan

    async def send_code(self, phone):
        self.calls.append(("send_code", phone))
        return {"phone_code_hash": "hash-1", **self.sent[0]}

    async def resend_code(self, phone, code_hash):
        self.calls.append(("resend_code", phone, code_hash))
        if "resend" in self.errors:
            raise rpc_error(400, self.errors["resend"])
        n = sum(c[0] == "resend_code" for c in self.calls)
        return {"phone_code_hash": f"hash-{n + 1}", **self.sent[n]}

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
        self.members_error = self.run_error = None
        self.running = False
        self.ended = False
        self.end_error = None
        self.ping_error = None
        self.pings = 0
        self.home = True  # still on the session's own DC and key

    def at_home(self):
        return self.home

    async def alive(self):
        self.pings += 1
        if self.ping_error:
            raise self.ping_error

    async def end_session(self):
        if self.end_error:
            raise self.end_error
        self.ended = True

    async def run(self):
        self.running = True
        try:
            if self.run_error:
                raise self.run_error
            await asyncio.Event().wait()
        finally:
            self.running = False

    async def members(self, chat_id):
        if self.members_error:
            raise self.members_error
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
        ("FLOOD_WAIT_120", "Telegram ограничил попытки входа: повторите через 120 с."),
        ("API_ID_INVALID", "Неверные API ID или API HASH: проверьте их на my.telegram.org."),
    ],
)
async def test_a_flood_limit_or_bad_api_data_starts_over(adb, account, logins, rpc, error):
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
        "step": None, "input": None, "state": None, "error": "Вход прерван, начните заново.",
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
        await fetch_users(account, -100)
    assert "войдите" in NO_SESSION


async def test_login_starts_the_user_client_without_a_restart(adb, account, clients):
    await send_code(adb, account)
    await ask(adb, "code", "12345")
    await account.tick()
    await asyncio.sleep(0)
    assert clients[0].args == (2040, "hash", PAYLOAD) and clients[0].running
    assert await fetch_users(account, -100) == [{"user_id": 1}, {"user_id": 2}]
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
        await fetch_users(account, -100)


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
        self.mt._parse_rpc_result = lambda result: {"ok": True, "phone_code_hash": "h", "parsed_by": "goygram"}
        self.mt.qr_update_ev = asyncio.Event()

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
        return {"phone_code_hash": "hash-1"}

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


async def test_the_vault_is_a_private_directory_per_client(monkeypatch, tmp_path):
    monkeypatch.setattr(bot.account.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(bot.account, "MembersClient", FakeMembers)
    a = await open_client(2040, "hash", PAYLOAD)
    assert a.vault.is_file() and a.kw["session"].path == a.vault
    assert stat.S_IMODE(os.stat(a.vault.parent).st_mode) == 0o700
    b = await open_client(2040, "hash", PAYLOAD)  # after a logout or a new login
    assert b.vault.parent != a.vault.parent and not a.vault.parent.exists()


async def test_the_vault_is_deleted_when_the_client_stops(monkeypatch, tmp_path):
    monkeypatch.setattr(bot.account.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(bot.account, "MembersClient", FakeMembers)
    client = await open_client(2040, "hash", PAYLOAD)

    async def done(self):
        pass

    monkeypatch.setattr(bot.account.GoyGram, "run", done)
    members = MembersClient.__new__(MembersClient)
    members.vault = client.vault
    await members.run()
    assert not client.vault.parent.exists()


async def test_a_failed_client_start_leaves_no_vault(monkeypatch, tmp_path):
    monkeypatch.setattr(bot.account.tempfile, "tempdir", str(tmp_path))
    made = []

    def broken(**kw):
        made.append(kw["session"].path)
        raise ConnectionError("dc probe failed")

    monkeypatch.setattr(bot.account, "MembersClient", broken)
    with pytest.raises(ConnectionError):
        await open_client(2040, "hash", PAYLOAD)
    assert not made[0].parent.exists()


async def test_vaults_left_by_a_killed_process_are_removed(monkeypatch, tmp_path):
    monkeypatch.setattr(bot.account.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(bot.account, "MembersClient", FakeMembers)
    stale = tmp_path / "members-old"
    stale.mkdir()
    (stale / "members.vault").write_text("key")  # docker stop: SIGTERM skips the cleanup in run()
    client = await open_client(2040, "hash", PAYLOAD)
    assert not stale.exists() and client.vault.parent.parent == tmp_path


def sending(account, logins, *sent):
    """The next login answers auth.sendCode, then each auth.resendCode, with these."""
    async def connect(*a):
        logins.append(await _with(FakeLogin(*a), sent=list(sent)))
        return logins[-1]

    account.connect = connect


async def delivery(db):
    return tuple(await db.fetchrow("SELECT state, sent, resend FROM mtproto_login"))


@pytest.mark.parametrize(
    "sent, text, resend",
    [
        (APP_CODE, ("Код для +7••••••1122 отправлен в чат «Telegram» в приложении, где вы уже вошли (5 цифр). "
         "Другой способ (SMS) — кнопкой ниже, Telegram разрешит его через 60 с."), True),
        ({"type": {"_": "auth.sentCodeTypeSms", "length": 5}}, "Код для +7••••••1122 отправлен по SMS (5 цифр).", False),
        ({"type": {"_": "auth.sentCodeTypeEmailCode", "email_pattern": "a***@mail.ru", "length": 6}},
         "Код для +7••••••1122 отправлен на почту a***@mail.ru (6 цифр).", False),
        ({"type": {"_": "auth.sentCodeTypeSetUpEmailRequired"}, "next_type": {"_": "auth.codeTypeSms"}},
         ("Telegram выбрал способ доставки кода, который этот вход не поддерживает (auth.sentCodeTypeSetUpEmailRequired). "
         "Другой способ (SMS) — кнопкой ниже."), True),
        ({"type": {"_": "auth.sentCodeTypeFirebaseSms", "length": 5}},
         ("Telegram выбрал способ доставки кода, который этот вход не поддерживает (auth.sentCodeTypeFirebaseSms). "
         "Других способов Telegram не предложил: начните заново позже или войдите с другого номера."), False),
        ({}, "Telegram не сообщил, куда отправил код для +7••••••1122.", False),
    ],
)
async def test_the_panel_and_the_log_say_where_the_code_went(adb, account, logins, caplog, sent, text, resend):
    caplog.set_level("INFO", logger="bot.account")
    sending(account, logins, sent)
    await send_code(adb, account)
    assert await delivery(adb) == ("code", text, resend)
    kind, nxt = (sent.get("type") or {}).get("_"), (sent.get("next_type") or {}).get("_")
    assert f"auth.sentCode type={kind} next_type={nxt} timeout={sent.get('timeout')}" in caplog.text
    assert "1122" not in caplog.text and "9990001122" not in caplog.text


async def test_resend_asks_telegram_for_the_next_way_and_signs_in_with_the_new_hash(adb, account, logins):
    sending(account, logins, APP_CODE, {"type": {"_": "auth.sentCodeTypeSms", "length": 5}})
    await send_code(adb, account)
    await ask(adb, "resend", "")
    await account.tick()
    assert logins[0].calls[-1] == ("resend_code", "+79990001122", "hash-1")
    assert await delivery(adb) == ("code", "Код для +7••••••1122 отправлен по SMS (5 цифр).", False)
    await ask(adb, "code", "12345")
    await account.tick()
    assert logins[0].calls[-1] == ("sign_in", "+79990001122", "hash-2", "12345")
    assert await delivery(adb) == (None, None, False)


async def test_no_other_way_to_send_the_code_keeps_the_code_step(adb, account, logins):
    await send_code(adb, account)
    logins[0].errors["resend"] = "SEND_CODE_UNAVAILABLE"
    await ask(adb, "resend", "")
    await account.tick()
    row = await login_row(adb)
    assert (row["state"], row["error"]) == ("code", "Других способов отправить код нет.")
    assert (await delivery(adb))[1].startswith("Код для +7")  # the last delivery stays on screen
    assert not logins[0].closed


async def test_a_wrong_code_keeps_the_delivery_on_screen(adb, account, logins):
    await send_code(adb, account)
    logins[0].errors["111"] = "PHONE_CODE_INVALID"
    await ask(adb, "code", "111")
    await account.tick()
    assert (await delivery(adb))[1].startswith("Код для +7")


async def test_every_step_the_bot_takes_is_logged_without_its_input(adb, account, caplog):
    caplog.set_level("INFO", logger="bot.account")
    await send_code(adb, account)
    assert "login step phone taken" in caplog.text and "9990001122" not in caplog.text


async def test_goygram_login_keeps_the_whole_sent_code(monkeypatch):
    # GoyGram's transport reduces auth.sentCode to its hash; the delivery type must survive for the panel.
    full = {"_": "auth.sentCode", "phone_code_hash": "h", **APP_CODE}
    decoded = {b"sent": full, b"other": {"_": "auth.authorization"}}
    monkeypatch.setattr(bot.account.tl, "deserialize_constructor", decoded.get)
    app = FakeApp({})
    GoyGramLogin(app)
    assert app.mt._parse_rpc_result(b"sent") == {"ok": True, "phone_code_hash": "h", "sent_code": full}
    assert app.mt._parse_rpc_result(b"other")["parsed_by"] == "goygram"


async def test_goygram_login_sends_and_resends_the_code():
    sent = {"_": "auth.sentCode", "phone_code_hash": "h2", **APP_CODE}
    app = FakeApp({"auth_resend_code": {"ok": True, "phone_code_hash": "h2", "sent_code": sent},
                   "auth_send_code": {"ok": True, "phone_code_hash": "h1"}})
    login = GoyGramLogin(app)
    assert await login.send_code("+7999") == {"phone_code_hash": "h1"}  # no decoded sentCode: the hash alone
    assert await login.resend_code("+7999", "h1") == sent
    assert app.calls[1] == ("auth_resend_code", {"retry": 0, "phone_number": "+7999", "phone_code_hash": "h1"})


async def qr_row(db):
    return dict(await db.fetchrow("SELECT step, state, error, qr FROM mtproto_login"))


async def show_qr(db, account):
    await ask(db, "qr", "")
    await account.tick()


async def test_qr_step_shows_the_login_link_in_the_panel(adb, account, logins):
    await show_qr(adb, account)
    assert logins[0].api == (2040, "hash") and logins[0].calls == [("qr",)]
    assert await qr_row(adb) == {"step": None, "state": "qr", "error": None, "qr": QR["url"]}
    await account.tick()
    assert logins[0].calls == [("qr",)]  # neither scanned nor expiring: no new token
    logins[0].scan = True
    await account.tick()
    assert logins[0].calls == [("qr",)]  # scanned, but renewed under QR_GAP ago: waits


@pytest.fixture
def no_qr_gap(monkeypatch):
    monkeypatch.setattr(bot.account, "QR_GAP", 0)


async def test_a_qr_failure_with_a_hyphen_starts_over(adb, account, logins):
    await ask(adb, "qr", "")
    account.connect = _connect_with(logins, qr=["AUTH_KEY-UNREGISTERED"])
    await account.tick()
    row = await qr_row(adb)
    assert (row["state"], row["qr"]) == (None, None) and "AUTH_KEY-UNREGISTERED" in row["error"]
    assert logins[0].closed


async def test_the_qr_code_is_renewed_before_it_expires(adb, account, logins, no_qr_gap):
    logins_qr = [{"url": "tg://login?token=OLD", "expires": int(time.time()) + 3}, QR]
    await ask(adb, "qr", "")
    account.connect = _connect_with(logins, qr=logins_qr)
    await account.tick()
    await account.tick()
    assert logins[0].calls == [("qr",), ("qr",)]
    assert (await qr_row(adb))["qr"] == QR["url"]


async def test_scanning_the_qr_code_stores_the_session(adb, account, logins, no_qr_gap):
    await ask(adb, "qr", "")
    account.connect = _connect_with(logins, qr=[QR, PAYLOAD])
    await account.tick()
    logins[0].scan = True
    await account.tick()
    assert json.loads(decrypt(await adb.fetchval("SELECT api_session FROM settings"), SECRET)) == PAYLOAD
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"
    assert await qr_row(adb) == {"step": None, "state": None, "error": None, "qr": None}
    assert logins[0].closed


async def test_qr_login_with_two_factor_asks_for_the_password(adb, account, logins, no_qr_gap):
    await ask(adb, "qr", "")
    account.connect = _connect_with(logins, qr=[QR, "SESSION_PASSWORD_NEEDED"])
    await account.tick()
    logins[0].scan = True
    await account.tick()
    assert await qr_row(adb) == {"step": None, "state": "password", "error": None, "qr": None}
    logins[0].scan = True
    await account.tick()
    assert logins[0].calls == [("qr",), ("qr",)]  # the QR code is done with
    await ask(adb, "password", "secret")
    await account.tick()
    assert logins[0].calls[-1] == ("check_password", "secret")
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"


async def test_an_unscanned_qr_code_gives_up_after_a_while(adb, account, logins, monkeypatch, no_qr_gap):
    monkeypatch.setattr(bot.account, "QR_TTL", -1)
    await ask(adb, "qr", "")
    account.connect = _connect_with(logins, qr=[{"url": "tg://login?token=OLD", "expires": 0}])
    await account.tick()
    await account.tick()
    row = await qr_row(adb)
    assert (row["state"], row["qr"]) == (None, None) and "QR" in row["error"]
    assert logins[0].closed and logins[0].calls == [("qr",)]


def _connect_with(logins, qr):
    async def connect(api_id, api_hash):
        logins.append(FakeLogin(api_id, api_hash))
        logins[-1].qr = qr
        return logins[-1]

    return connect


async def test_goygram_qr_login_gives_a_tg_login_link():
    app = FakeApp({"auth_export_login_token": {"ok": True, "type": "loginToken", "expires": 123, "token": b"\xfb\xff"}})
    assert await GoyGramLogin(app).qr_login() == {"url": "tg://login?token=-_8", "expires": 123}
    assert app.calls[0][1]["except_ids"] == []


async def test_goygram_qr_login_imports_the_token_on_the_dc_it_migrates_to(monkeypatch):
    app = FakeApp({
        "auth_export_login_token": {"ok": True, "type": "loginTokenMigrateTo", "dc_id": 4, "token": b"t"},
        "auth_import_login_token": {"ok": True, "type": "loginTokenSuccess", "user": USER},
    })
    switched = []

    async def switch_dc(app_, dc):
        switched.append(dc)

    monkeypatch.setattr(bot.account, "_switch_dc", switch_dc)
    assert (await GoyGramLogin(app).qr_login())["dc"] == 4
    assert switched == [4] and app.calls[1][0] == "auth_import_login_token" and app.calls[1][1]["token"] == b"t"


async def test_goygram_qr_login_on_another_dc_asks_for_the_password(monkeypatch):
    app = FakeApp({
        "auth_export_login_token": {"ok": True, "type": "loginTokenMigrateTo", "dc_id": 4, "token": b"t"},
        "auth_import_login_token": {"error_message": "SESSION_PASSWORD_NEEDED"},
        "auth_check_password": {"user": USER},
    })
    switched = []

    async def switch_dc(app_, dc):
        switched.append(dc)

    monkeypatch.setattr(bot.account, "_switch_dc", switch_dc)
    login = GoyGramLogin(app)
    with pytest.raises(Exception, match="SESSION_PASSWORD_NEEDED"):
        await login.qr_login()
    assert switched == [4]
    assert (await login.check_password("secret"))["user"] == USER  # on the DC it moved to


async def test_goygram_qr_login_forgets_a_scan_of_an_older_code():
    app = FakeApp({"auth_export_login_token": {"ok": True, "type": "loginToken", "expires": 1, "token": b"t"}})
    app.mt.qr_update_ev.set()
    login = GoyGramLogin(app)
    await login.qr_login()
    assert not login.scanned()


async def test_goygram_qr_login_sees_the_scan():
    app = FakeApp({})
    login = GoyGramLogin(app)
    assert not login.scanned()
    app.mt.qr_update_ev.set()
    assert login.scanned() and not login.scanned()


async def test_clients_introduce_themselves_to_telegram(monkeypatch, tmp_path):
    monkeypatch.setattr(bot.account.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(bot.account, "MembersClient", FakeMembers)
    monkeypatch.setattr(bot.account, "GoyGram", lambda **kw: kw)
    monkeypatch.setattr(bot.account, "GoyGramLogin", lambda app: app)
    for kw in (await bot.account.connect(2040, "hash"), (await open_client(2040, "hash", PAYLOAD)).kw):
        assert kw["device_model"] == "Chat Manager" and kw["lang_code"] == kw["system_lang_code"] == "ru"
        assert kw["app_version"] and kw["system_version"] != "Unknown"


async def test_start_over_in_the_panel_stops_the_qr_login(adb, account, logins, no_qr_gap):
    await ask(adb, "qr", "")
    account.connect = _connect_with(logins, qr=[QR, PAYLOAD])
    await account.tick()
    await adb.execute("DELETE FROM mtproto_login")  # «Начать заново»
    logins[0].scan = True
    await account.tick()
    assert logins[0].calls == [("qr",)] and logins[0].closed
    assert await adb.fetchval("SELECT api_session FROM settings") is None


async def test_a_qr_code_left_by_a_restarted_bot_is_withdrawn(adb, account):
    await adb.execute("INSERT INTO mtproto_login (id, state, qr) VALUES (1, 'qr', 'tg://login?token=OLD')")
    await account.tick()
    assert await qr_row(adb) == {"step": None, "state": None, "error": "Вход прерван, начните заново.", "qr": None}


ENDED = "Сессия завершена в Telegram, войдите заново."


async def account_state(db):
    return (*await db.fetchrow("SELECT api_session, api_account FROM settings"), (await login_row(db))["error"])


def later(account):
    """DENY_GAP has passed: the restart hold is over and a first 401 is old enough to be confirmed."""
    account.hold = (account.hold[0], 0.0)
    if account.denied:
        account.denied = (account.denied[0], account.denied[1] - bot.account.DENY_GAP)


async def reopened(account):
    later(account)
    await account.tick()
    await asyncio.sleep(0)


@pytest.mark.parametrize("rpc", ["AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "USER_DEACTIVATED"])
async def test_a_second_401_a_while_later_forgets_the_session_and_explains(adb, account, clients, rpc):
    await logged_in(adb, account)
    clients[0].members_error = rpc_error(401, rpc)
    with pytest.raises(RPCError):  # the first one only restarts the client
        await fetch_users(account, -100)
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)" and not clients[0].running
    await account.tick()
    assert len(clients) == 1  # no restart before DENY_GAP
    await reopened(account)
    assert clients[1].running
    clients[1].members_error = rpc_error(401, rpc)
    with pytest.raises(MentionError, match=re.escape(NO_SESSION)):
        await fetch_users(account, -100)
    assert await account_state(adb) == (None, None, ENDED)
    assert account.client is None and not clients[1].running
    await reopened(account)
    assert len(clients) == 2  # nothing to restart


async def test_two_401s_too_close_together_keep_the_session(adb, account, clients):
    await logged_in(adb, account)
    clients[0].members_error = rpc_error(401, "AUTH_KEY_UNREGISTERED")
    with pytest.raises(RPCError):
        await fetch_users(account, -100)
    account.hold = (account.hold[0], 0.0)  # the client is back, but the first 401 is fresh
    await account.tick()
    await asyncio.sleep(0)
    clients[1].members_error = rpc_error(401, "AUTH_KEY_UNREGISTERED")
    with pytest.raises(RPCError):
        await fetch_users(account, -100)
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"


async def test_a_401_away_from_the_home_dc_or_key_keeps_the_session(adb, account, clients):
    await logged_in(adb, account)
    for i in range(3):  # goygram moved the session to another DC or followed *_MIGRATE with a new key
        clients[i].home = False
        clients[i].members_error = rpc_error(401, "AUTH_KEY_UNREGISTERED")
        with pytest.raises(RPCError):
            await fetch_users(account, -100)
        assert account.denied is None and not clients[i].running
        await reopened(account)
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)" and account.denied is None
    assert clients[3].running


async def test_an_answer_between_two_401s_keeps_the_session(adb, account, clients):
    await logged_in(adb, account)
    clients[0].members_error = rpc_error(401, "AUTH_KEY_UNREGISTERED")
    with pytest.raises(RPCError):
        await fetch_users(account, -100)
    await reopened(account)
    await check(account)  # answered
    assert account.denied is None
    clients[1].members_error = rpc_error(401, "AUTH_KEY_UNREGISTERED")
    later(account)
    with pytest.raises(RPCError):
        await fetch_users(account, -100)
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"


async def test_a_user_client_stopped_by_an_ended_session_is_restarted_then_forgotten(adb, account, clients):
    real = account.open_client

    async def failing(*a):
        c = await real(*a)
        c.run_error = rpc_error(401, "SESSION_REVOKED")
        return c

    account.open_client = failing
    await logged_in(adb, account)
    await account.tick()
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"
    await reopened(account)
    await account.tick()
    assert len(clients) == 2 and await account_state(adb) == (None, None, ENDED)
    with pytest.raises(MentionError):
        await fetch_users(account, -100)


async def test_other_member_list_errors_keep_the_session(adb, account, clients):
    await logged_in(adb, account)
    clients[0].members_error = rpc_error(400, "CHANNEL_INVALID")
    with pytest.raises(Exception, match="CHANNEL_INVALID"):
        await fetch_users(account, -100)
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)"
    assert account.client is clients[0]


async def test_an_undecryptable_session_is_reset_with_a_reason(adb, account, clients):
    await adb.execute("UPDATE settings SET api_session = $1, api_account = 'Анна'", encrypt("{}", "old-secret"))
    await account.tick()
    session, name, error = await account_state(adb)
    assert (session, name, clients) == (None, None, []) and "AUTH_SECRET" in error


async def test_a_new_step_sent_while_the_bot_works_is_kept(adb, account, logins):
    async def slow_send_code(phone):
        await ask(adb, "qr", "")  # «Начать заново», then «Войти по QR-коду», before Telegram answered
        return {"phone_code_hash": "hash-1"}

    async def connect(*a):
        return await _with(FakeLogin(*a), send_code=slow_send_code)

    account.connect = connect
    await ask(adb, "phone", "+79990001122")
    await account.tick()
    row = await login_row(adb)
    assert row["step"] == "qr" and row["input"] is not None


async def test_a_login_finished_after_start_over_stores_no_session(adb, account, logins):
    await send_code(adb, account)
    real = logins[0].sign_in

    async def sign_in(*a):
        await adb.execute("DELETE FROM mtproto_login")  # «Начать заново» while Telegram signs in
        return await real(*a)

    logins[0].sign_in = sign_in
    await ask(adb, "code", "12345")
    await account.tick()
    assert await adb.fetchval("SELECT api_session FROM settings") is None and logins[0].closed


async def test_an_expired_code_keeps_the_code_step_and_offers_a_new_one(adb, account, logins):
    sending(account, logins, {"type": {"_": "auth.sentCodeTypeSms", "length": 5}})
    await send_code(adb, account)
    logins[0].errors["12345"] = "PHONE_CODE_EXPIRED"
    await ask(adb, "code", "12345")
    await account.tick()
    row = await login_row(adb)
    assert (row["state"], row["error"]) == ("code", "Код просрочен, запросите новый.")
    assert (await delivery(adb))[2] is True and not logins[0].closed


SILENT = "Аккаунт Telegram не отвечает"


async def check(account):
    """One liveness check, due now, and its outcome handled by the next tick."""
    account.ping_at = 0
    await account.tick()
    await asyncio.wait({account._ping})
    await account.tick()


async def test_a_401_confirmed_by_the_next_check_forgets_the_session(adb, account, clients):
    await logged_in(adb, account)
    clients[0].ping_error = rpc_error(401, "AUTH_KEY_UNREGISTERED")
    await check(account)
    assert await adb.fetchval("SELECT api_account FROM settings") == "Анна (@anna)" and not clients[0].running
    await reopened(account)
    assert account.ping_at < time.monotonic() + bot.account.PING_EVERY  # confirmed soon, not in 5 minutes
    clients[1].ping_error = rpc_error(401, "AUTH_KEY_UNREGISTERED")
    await check(account)
    assert await account_state(adb) == (None, None, ENDED)
    assert account.client is None and not clients[1].running


async def test_unanswered_checks_warn_and_reconnect_but_keep_the_session(adb, account, clients):
    await logged_in(adb, account)
    clients[0].ping_error = TimeoutError()
    for _ in range(2):
        await check(account)
    assert await adb.fetchval("SELECT error FROM mtproto_login") is None and account.client is clients[0]
    await check(account)
    session, name, error = await account_state(adb)
    assert session is not None and name == "Анна (@anna)" and error.startswith(SILENT)
    assert not clients[0].running
    await reopened(account)  # reconnects from the stored session, DENY_GAP later
    assert len(clients) == 2 and clients[1].running and clients[1].args == clients[0].args
    await check(account)  # the new client answers
    assert await account_state(adb) == (session, name, None)
    assert account.client is clients[1]


async def test_a_flood_wait_counts_as_an_answer_and_delays_the_next_check(adb, account, clients):
    await logged_in(adb, account)
    clients[0].ping_error = rpc_error(420, "FLOOD_WAIT_3600")
    for _ in range(3):
        await check(account)
    assert account.misses == 0 and account.client is clients[0]
    assert account.ping_at > time.monotonic() + 3000


async def test_no_check_before_it_is_due(adb, account, clients):
    await logged_in(adb, account)
    await account.tick()
    assert clients[0].pings == 0 and account._ping is None


async def test_members_alive_waits_for_the_restored_session_and_never_sleeps_on_flood_wait():
    members = MembersClient.__new__(MembersClient)
    calls = []

    async def call(act, **kw):
        calls.append((act, kw))

    members.mt = type("Mt", (), {"reader_task": None, "call": staticmethod(call)})()
    with pytest.raises(TimeoutError):  # a call now would make a fresh key and a false 401
        await members.alive()
    members.mt.reader_task = object()
    await members.alive()
    assert calls == [("updates.getState", {"retry": 0})]


def test_members_client_is_at_home_only_on_the_stored_dc_with_the_stored_key():
    members = MembersClient.__new__(MembersClient)
    members.home = (2, b"key")
    members.mt = type("Mt", (), {"host": "149.154.167.50", "port": 443, "auth_key": b"key"})()
    assert members.at_home()
    members.mt.host = "149.154.167.91"  # re-homed to dc4 (bootstrap) or _connect picked another DC
    assert not members.at_home()
    members.mt.host, members.mt.auth_key = "149.154.167.50", b"new"  # *_MIGRATE: a fresh, unauthorised key
    assert not members.at_home()


async def test_members_carry_the_names_and_usernames_from_every_page(monkeypatch):
    monkeypatch.setattr(bot.account, "PAGE", 2)
    members = MembersClient.__new__(MembersClient)
    pages = [
        [{"_": "channelParticipantCreator", "user_id": 1}, {"_": "channelParticipant", "user_id": 2}],
        [{"_": "channelParticipant", "user_id": 3}],
    ]
    users = [
        {"_": "user", "id": 1, "access_hash": 9, "first_name": "Анна", "last_name": "К", "username": "anna"},
        {"_": "user", "id": 2, "first_name": "Борис"},
        {"_": "user", "id": 3, "first_name": "Вера", "username": "vera"},
    ]
    calls = []

    async def typed_peer(target, kind):
        return {"_": "inputChannel", "target": target, "kind": kind}

    async def mt_req(act, **kw):
        calls.append((act, kw["channel"]["target"], kw["offset"], kw["limit"]))
        page = pages[kw["offset"] // 2]
        return {"result": {"participants": page, "users": [u for u in users if any(p["user_id"] == u["id"] for p in page)]}}

    members.raw_chat = lambda chat_id: chat_id
    members._typed_peer = typed_peer
    members.mt_req = mt_req
    assert [m async for m in members.members(-100)] == [
        {"user_id": 1, "first_name": "Анна", "last_name": "К", "username": "anna"},
        {"user_id": 2, "first_name": "Борис", "last_name": None, "username": None},
        {"user_id": 3, "first_name": "Вера", "last_name": None, "username": "vera"},
    ]
    assert calls == [("channels.getParticipants", -100, 0, 2), ("channels.getParticipants", -100, 2, 2)]


@pytest.mark.parametrize(
    "res",
    [
        {"result": None},  # no page at all: an empty list, as in goygram
        {"participants": [{"user_id": 1}], "users": [{"_": "userEmpty"}, {"id": 2, "first_name": "Чужой"}]},
    ],
)
async def test_members_survive_an_odd_response(res):
    members = MembersClient.__new__(MembersClient)

    async def typed_peer(target, kind):
        return {}

    async def mt_req(act, **kw):
        return res

    members.raw_chat = lambda chat_id: chat_id
    members._typed_peer = typed_peer
    members.mt_req = mt_req
    got = [m async for m in members.members(-100)]
    assert got == ([{"user_id": 1, "first_name": None, "last_name": None, "username": None}] if "users" in res else [])
