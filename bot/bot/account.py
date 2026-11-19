"""The MTProto user account behind /all and member lists: login steps from the panel, and its client."""

import asyncio
import base64
import json
import logging
import platform
import secrets
import shutil
import tempfile
import time
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

import asyncpg
from goygram import GoyGram
from goygram import ext as tl
from goygram.dc_fetcher import get_dynamic_dc_config, pick_dc_endpoint, pick_reachable_dc
from goygram.errors import FloodWaitError, RPCError, rpc_error
from goygram.security import (
    _current_dc_id,
    _extension,
    _extract_auth_blob,
    _extract_error,
    _extract_phone_code_hash,
    _extract_user,
    _field,
    _mt_req_with_migrate,
)
from goygram.session import Session

from bot.mention import NO_SESSION, MentionError
from bot.settings import _open, decrypt, encrypt, load_settings

log = logging.getLogger(__name__)

# Taking the step clears its input, so a code or password never stays in the DB; the step itself stays
# until the answer is written (_report), so the panel keeps waiting meanwhile.
CLAIM = (
    "UPDATE mtproto_login l SET input = NULL, error = NULL, updated_at = now() "
    "FROM (SELECT step, input FROM mtproto_login WHERE id = 1 FOR UPDATE) old "
    "WHERE l.id = 1 AND old.input IS NOT NULL RETURNING old.step, old.input"
)


# How long the bot keeps renewing an unscanned QR code (Telegram renews each one about every 30 s).
QR_TTL = 5 * 60
# Renew the QR code at most this often (s): a skewed server clock must not hit auth.exportLoginToken every tick.
QR_GAP = 10
# initConnection: a client calling itself "Unknown" 1.0 is a reason for Telegram not to deliver login codes (#36).
CLIENT: dict[str, Any] = {
    "device_model": "Chat Manager",
    # shortcut: kept in sync with bot/pyproject.toml by hand (the image skips the project's metadata, so no
    # importlib.metadata); switch to importlib.metadata once releases install the project.
    "app_version": "0.1.0",
    "system_version": f"{platform.system()} {platform.release()}",
    "system_lang_code": "ru",
    "lang_code": "ru",
}

# Errors Telegram lets the user retry within the same login; any other starts the login over.
RETRY = {
    "code": ("PHONE_CODE_INVALID", "PHONE_CODE_EXPIRED"),
    "password": ("PASSWORD_HASH_INVALID",),
    "resend": ("SEND_CODE_UNAVAILABLE",),
}
ENDED = "Сессия завершена в Telegram, войдите заново."
SILENT = "Аккаунт Telegram не отвечает: бот переподключается. Если не пройдёт, отключите аккаунт и войдите заново."
# Liveness check of the user client (#66): goygram never reports a dead auth key, it only times out.
PING_EVERY = 5 * 60
PING_TIMEOUT = 45  # goygram itself gives up on a call after 30 s
MISSES = 3  # unanswered checks in a row before the warning and a reconnect; a session is never dropped for them
# A 401 ends the session only if a second one comes at least this long (s) after the first; a restarted client
# waits as long, so restarts never hammer Telegram.
DENY_GAP = 60
UNREADABLE = "Сессия не расшифровывается (сменился AUTH_SECRET?), войдите заново."
REASONS = {
    "SEND_CODE_UNAVAILABLE": "Других способов отправить код нет.",
    "PHONE_CODE_INVALID": "Неверный код.",
    "PASSWORD_HASH_INVALID": "Неверный пароль.",
    "PHONE_CODE_EXPIRED": "Код просрочен, запросите новый.",
    "PHONE_NUMBER_INVALID": "Неверный номер телефона.",
    "PHONE_NUMBER_BANNED": "Номер заблокирован в Telegram.",
    "API_ID_INVALID": "Неверные API ID или API HASH: проверьте их на my.telegram.org.",
}


# auth.sentCode.type → how the code reaches the user; fields in {} come from the type itself.
DELIVERY = {
    "auth.sentCodeTypeApp": "отправлен в чат «Telegram» в приложении, где вы уже вошли",
    "auth.sentCodeTypeSms": "отправлен по SMS",
    "auth.sentCodeTypeSmsWord": "отправлен по SMS",
    "auth.sentCodeTypeSmsPhrase": "отправлен по SMS",
    "auth.sentCodeTypeCall": "придёт голосовым звонком",
    "auth.sentCodeTypeMissedCall": "придёт пропущенным звонком: код — последние цифры номера, начинающегося с {prefix}",
    "auth.sentCodeTypeEmailCode": "отправлен на почту {email_pattern}",
    "auth.sentCodeTypeFragmentSms": "отправлен через Fragment: {url}",
}
NEXT = {
    "auth.codeTypeSms": "SMS",
    "auth.codeTypeCall": "звонок",
    "auth.codeTypeFlashCall": "flash-звонок",
    "auth.codeTypeMissedCall": "пропущенный звонок",
    "auth.codeTypeFragmentSms": "Fragment",
}


def delivery(sent: dict[str, Any], phone: str) -> tuple[str, bool]:
    """The panel's note on an auth.sentCode, and whether auth.resendCode has another way to offer."""
    kind, nxt, timeout = sent.get("type") or {}, (sent.get("next_type") or {}).get("_"), sent.get("timeout")
    log.info("auth.sentCode type=%s next_type=%s timeout=%s", kind.get("_"), nxt, timeout)
    masked = phone[:2] + "•" * (len(phone) - 6) + phone[-4:]
    if not kind:
        text = f"Telegram не сообщил, куда отправил код для {masked}."
    elif how := DELIVERY.get(kind["_"]):
        text = f"Код для {masked} {how.format_map(defaultdict(lambda: "?", kind))}" + (f" ({kind['length']} цифр)." if kind.get("length") else ".")
    else:  # FirebaseSms, SetUpEmailRequired, FlashCall, …: need an official app
        text = f"Telegram выбрал способ доставки кода, который этот вход не поддерживает ({kind['_']})."
        if not nxt:
            text += " Других способов Telegram не предложил: начните заново позже или войдите с другого номера."
    if nxt:
        text += f" Другой способ ({NEXT.get(nxt, nxt)}) — кнопкой ниже" + (
            f", Telegram разрешит его через {timeout} с." if timeout else "."
        )
    return text, bool(nxt)


def reason(e: Exception) -> str:
    if isinstance(e, FloodWaitError):
        return f"Telegram ограничил попытки входа: повторите через {e.seconds} с."
    return next((r for code, r in REASONS.items() if code in str(e)), f"Ошибка Telegram: {str(e) or type(e).__name__}")


class Account:
    """Stands in for the user client everywhere (`user`), so login and logout swap it without a restart."""

    def __init__(
        self,
        db: asyncpg.Pool,
        secret: str,
        connect: Callable[[int, str], Awaitable[Any]],
        open_client: Callable[[int, str, dict[str, Any]], Awaitable[Any]],
    ) -> None:
        self.db, self.secret, self.connect, self.open_client = db, secret, connect, open_client
        self.login: Any = None  # the client mid-login, between the phone and the last step
        self.phone = self.code_hash = ""
        self.sent: tuple[str | None, bool] = (None, False)  # delivery() of the last code, for the panel
        self.qr: dict[str, Any] = {}  # the QR code the panel shows (url, expires) while the state is qr
        self.qr_until = 0.0  # when the bot stops renewing an unscanned QR code
        self.qr_at = 0.0  # time.monotonic() of the last auth.exportLoginToken
        self.client: Any = None
        self._task: asyncio.Task[None] | None = None
        self._session: str | None = None  # the stored ciphertext the client runs with
        self._ping: asyncio.Task[None] | None = None
        self.ping_at = 0.0  # time.monotonic() of the next liveness check
        self.misses = 0  # liveness checks in a row the client did not answer
        self.denied: tuple[str | None, float] | None = None  # (session, time.monotonic()) of its first 401 at home
        self.hold: tuple[str | None, float] = (None, 0.0)  # a restarted session reopens only after that time

    async def iter_participants(self, chat_id: int) -> AsyncIterator[Any]:
        if self.client is None:
            raise MentionError(NO_SESSION)
        session = self._session
        try:
            async for p in self.client.members(chat_id):
                yield p
        except RPCError as e:
            if not _ended(e):
                raise
            if await self._rejected(session):
                raise MentionError(NO_SESSION) from e
            raise

    async def run(self, interval: float = 2) -> None:
        while True:
            try:
                await self.tick()
            except Exception:
                log.exception("account tick failed")
            await asyncio.sleep(interval)

    async def tick(self) -> None:
        await self.db.execute("UPDATE settings SET bot_seen_at = now() WHERE id = 1")
        if row := await self.db.fetchrow(CLAIM):
            await self.step(row["step"], row["input"])
        shown = await self.db.fetchval("SELECT state = 'qr' FROM mtproto_login WHERE id = 1")
        if self.qr and not shown:  # «Начать заново»: a later scan must not log in
            await self._drop()
        elif shown and not self.qr:  # the bot restarted: nothing renews that code any more
            await self._report(None, "Вход прерван, начните заново.")
        # A scan (updateLoginToken) or an expiring token: auth.exportLoginToken again for the session or a new code.
        # The gap goes first: scanned() consumes the update, which must wait for the next allowed renewal.
        if (
            self.qr
            and self.login is not None
            and time.monotonic() >= self.qr_at + QR_GAP
            and (self.login.scanned() or time.time() > self.qr["expires"] - 5)
        ):
            await self.step("qr_renew", None)
        if self._task and self._task.done() and not self._task.cancelled() and _ended(self._task.exception()):
            await self._rejected(self._session)
        if self._ping and self._ping.done():
            ping, self._ping = self._ping, None
            await self._pinged(ping.exception())
        if self.client is not None and self._ping is None and time.monotonic() >= self.ping_at:
            self._ping = asyncio.create_task(self._check())
        session = await self.db.fetchval("SELECT api_session FROM settings WHERE id = 1")
        held = self.hold[0] == session and time.monotonic() < self.hold[1]
        if session != self._session and not held:  # a login, «Выйти» in the panel, or a restart
            await self._stop_client()
            plain = _open(session, self.secret)
            if session and plain is None:
                return await self._forget(session, UNREADABLE)
            if plain:
                s = await load_settings(self.db, self.secret)
                self.client = await self.open_client(s.api_id, s.api_hash, json.loads(plain))  # type: ignore[arg-type]
                self._task = asyncio.create_task(self.client.run())
                self._task.add_done_callback(_log_client_stop)
                # A first 401 is confirmed by the next check, once the client has restored the session.
                confirm = self.denied is not None and self.denied[0] == session
                self.ping_at = time.monotonic() + (DENY_GAP if confirm else PING_EVERY)
            self._session = session  # only now: a failed start is retried on the next tick

    async def stop(self) -> None:
        await self._drop()
        await self._stop_client()

    async def _forget(self, session: str | None, error: str) -> None:
        """The session stopped working: the panel shows why and asks for a new login."""
        log.warning("user session dropped: %s", error)
        await self._stop_client()
        self._session = None
        async with self.db.acquire() as c, c.transaction():
            # Only this session: a login finished meanwhile stays.
            if await c.fetchval(
                "UPDATE settings SET api_session = NULL, api_account = NULL WHERE id = 1 AND api_session = $1 "
                "RETURNING 1", session,
            ):
                await c.execute(
                    "INSERT INTO mtproto_login (id, error) VALUES (1, $1) "
                    "ON CONFLICT (id) DO UPDATE SET error = $1, updated_at = now()", error,
                )

    async def _stop_client(self) -> None:
        task, self._task, self.client = self._task, None, None
        ping, self._ping, self.misses = self._ping, None, 0
        for t in filter(None, (task, ping)):
            t.cancel()
            await asyncio.gather(t, return_exceptions=True)

    async def _check(self) -> None:
        if self._task is None or self._task.done():
            raise TimeoutError("the user client is not running")
        async with asyncio.timeout(PING_TIMEOUT):
            await self.client.alive()

    async def _pinged(self, e: BaseException | None) -> None:
        """A liveness check's outcome: 401 drops the session, silence warns and reconnects, an answer clears it."""
        # FLOOD_WAIT is an answer too, but the next check waits it out.
        self.ping_at = time.monotonic() + max(PING_EVERY, getattr(e, "seconds", 0))
        if _ended(e):
            await self._rejected(self._session)
            return
        if e is None or isinstance(e, RPCError):
            self.misses, self.denied = 0, None
            await self.db.execute("UPDATE mtproto_login SET error = NULL WHERE id = 1 AND error = $1", SILENT)
            return
        self.misses += 1
        log.warning("user client did not answer (%d in a row): %r", self.misses, e)
        if self.misses >= MISSES:
            await self.db.execute(
                "INSERT INTO mtproto_login (id, error) VALUES (1, $1) "
                "ON CONFLICT (id) DO UPDATE SET error = $1, updated_at = now()", SILENT,
            )
            await self._restart()

    async def _rejected(self, session: str | None) -> bool:
        """Telegram answered 401; True if the session is now forgotten.

        goygram moves a session to a reachable DC (bootstrap) or follows *_MIGRATE with a fresh, unauthorised key,
        and a 401 there says nothing about the stored session: only two 401s at least DENY_GAP apart, both at the
        session's home DC with its own key, end it. Any other 401 restarts the client from the stored session."""
        if session != self._session or self.client is None:
            return False  # a login or logout came first
        now = time.monotonic()
        if not self.client.at_home():
            log.warning("401 away from the session's home DC or key: restarting the user client")
        elif self.denied and self.denied[0] == session and now - self.denied[1] >= DENY_GAP:
            await self._forget(session, ENDED)
            return True
        elif not (self.denied and self.denied[0] == session):
            log.warning("401 at the session's home DC: dropping the session if the next check gets one too")
            self.denied = (session, now)
        await self._restart()
        return False

    async def _restart(self) -> None:
        """The next tick DENY_GAP from now starts the client again from the stored session."""
        self.hold = (self._session, time.monotonic() + DENY_GAP)
        await self._stop_client()
        self._session = None
    async def step(self, step: str, cipher: str | None) -> None:
        log.info("login step %s taken", step)
        try:
            await self._step(step, decrypt(cipher, self.secret) if cipher else "")
        except Exception as e:  # noqa: BLE001  any failure must reach the panel, not stop the loop
            if "SESSION_PASSWORD_NEEDED" in str(e):
                return await self._report("password")
            if any(r in str(e) for r in RETRY.get(step, ())):
                if "PHONE_CODE_EXPIRED" in str(e):  # auth.resendCode sends a new one
                    self.sent = (self.sent[0], True)
                return await self._report("code" if step == "resend" else step, reason(e))
            log.warning("login step %s failed: %r", step, e)
            await self._drop()
            await self._report(None, reason(e))

    async def _step(self, step: str, value: str) -> None:
        if step == "logout":
            await self._logout()
        elif step == "phone":
            await self._drop()
            s = await load_settings(self.db, self.secret)
            self.login = await self.connect(s.api_id, s.api_hash)  # type: ignore[arg-type]
            self.phone = value
            await self._code_sent(await self.login.send_code(value))
        elif step == "qr":
            await self._drop()
            s = await load_settings(self.db, self.secret)
            self.login = await self.connect(s.api_id, s.api_hash)  # type: ignore[arg-type]
            self.qr_until = time.time() + QR_TTL
            await self._qr()
        elif self.login is None:
            await self._report(None, "Вход прерван, начните заново.")
        elif step == "qr_renew":
            if time.time() > self.qr_until:
                await self._drop()
                await self._report(None, "QR-код никто не отсканировал, покажите новый.")
            else:
                await self._qr()
        elif step == "resend":
            await self._code_sent(await self.login.resend_code(self.phone, self.code_hash))
        elif step == "code":
            await self._finish(await self.login.sign_in(self.phone, self.code_hash, value))
        elif step == "password":
            await self._finish(await self.login.check_password(value))

    async def _qr(self) -> None:
        self.qr_at = time.monotonic()
        res = await self.login.qr_login()
        if "user" in res:
            return await self._finish(res)
        self.qr = res
        await self._report("qr")

    async def _code_sent(self, sent: dict[str, Any]) -> None:
        self.code_hash, self.sent = sent["phone_code_hash"], delivery(sent, self.phone)
        await self._report("code")

    async def _finish(self, session: dict[str, Any]) -> None:
        user = session["user"]
        name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")]))
        if user.get("username"):
            name += f" (@{user['username']})"
        async with self.db.acquire() as c, c.transaction():
            # No login row: «Начать заново» was pressed while Telegram answered, so this login is withdrawn.
            if await c.fetchval("SELECT 1 FROM mtproto_login WHERE id = 1 FOR UPDATE"):
                await c.execute(
                    "UPDATE settings SET api_session = $1, api_account = $2 WHERE id = 1",
                    encrypt(json.dumps(session), self.secret), name,
                )
        await self._drop()
        await self._report(None)

    async def _logout(self) -> None:
        """«Выйти»: ends the session in Telegram if it can; the panel forgets it either way."""
        error = None
        try:
            if self.client is None:
                raise RuntimeError("клиент не запущен")
            await self.client.end_session()
        except Exception as e:  # noqa: BLE001  best effort: a dead session must still leave the panel
            log.warning("auth.logOut failed: %r", e)
            error = (
                f"Сессия удалена из панели, но не завершена в Telegram ({reason(e)}). "
                "Завершите её в Telegram: Настройки → Устройства."
            )
        await self._stop_client()
        await self.db.execute("UPDATE settings SET api_session = NULL, api_account = NULL WHERE id = 1")
        self._session = None
        await self._report(None, error)

    async def _drop(self) -> None:
        self.qr, self.qr_until = {}, 0.0
        if self.login is not None:
            login, self.login = self.login, None
            await login.close()

    async def _report(self, state: str | None, error: str | None = None) -> None:
        sent, resend = self.sent if state == "code" else (None, False)
        if state != "qr":
            self.qr = {}  # scanned, needs the password, failed or gave up: stop renewing
        await self.db.execute(
            # A step the panel sent meanwhile (input set) stays for the next tick.
            "UPDATE mtproto_login SET step = CASE WHEN input IS NULL THEN NULL ELSE step END, "
            "state = $1, error = $2, sent = $3, resend = $4, qr = $5, updated_at = now() WHERE id = 1",
            state, error, sent, resend, self.qr.get("url"),
        )


def _ended(e: BaseException | None) -> bool:
    """Telegram ended the session (AUTH_KEY_UNREGISTERED, SESSION_REVOKED, USER_DEACTIVATED, …): all are 401.

    goygram 0.8.29 drops the transport's -404 (a dead auth key) silently: that shows up only as timeouts (_pinged)."""
    return isinstance(e, RPCError) and e.code == 401 and "SESSION_PASSWORD_NEEDED" not in e.message


# A stopped client is logged here; tick() forgets the session if Telegram ended it.
def _log_client_stop(task: "asyncio.Task[None]") -> None:
    if not task.cancelled():
        log.error("user client stopped: %r", task.exception() or "exited")


# GoyGram adapters. GoyGram's own phone login (goygram.security._mt_auth_flow) reads stdin, so the steps
# below repeat its calls one at a time with its private helpers.
# Private goygram API: goygram is pinned exactly in pyproject.toml; re-check these imports when upgrading it.
class GoyGramLogin:
    def __init__(self, app: Any) -> None:
        self.app = app
        parse = app.mt._parse_rpc_result

        # GoyGram's transport reduces auth.sentCode to its hash; keep the delivery type for the panel.
        def keep_sent_code(result: bytes) -> dict[str, Any]:
            with suppress(Exception):
                sent = tl.deserialize_constructor(result)
                if isinstance(sent, dict) and str(sent.get("_", "")).startswith("auth.sentCode"):
                    return {"ok": True, "phone_code_hash": sent.get("phone_code_hash"), "sent_code": sent}
            result_: dict[str, Any] = parse(result)
            return result_

        app.mt._parse_rpc_result = keep_sent_code

    async def _call(self, act: str, **kw: Any) -> dict[str, Any]:
        # retry=0: surface FLOOD_WAIT to the panel instead of sleeping on it; DC migration is still handled.
        res = await _mt_req_with_migrate(self.app, act, retry=0, **kw)
        if err := _extract_error(res):  # GoyGram returns some RPC errors as dicts instead of raising
            raise rpc_error(400, err)
        return res

    async def send_code(self, phone: str) -> dict[str, Any]:
        # The same codeSettings as GoyGram's own login (_mt_auth_flow): no flash/missed calls, no Firebase.
        settings = _extension().serialize_constructor("codeSettings", {"flags": 0})
        return self._sent(await self._call("auth_send_code", phone_number=phone, settings=settings))

    async def resend_code(self, phone: str, code_hash: str) -> dict[str, Any]:
        return self._sent(await self._call("auth_resend_code", phone_number=phone, phone_code_hash=code_hash))

    @staticmethod
    def _sent(res: dict[str, Any]) -> dict[str, Any]:
        sent: dict[str, Any] = res.get("sent_code") or {"phone_code_hash": _extract_phone_code_hash(res)}
        if not sent.get("phone_code_hash"):
            raise RuntimeError("auth.sendCode did not return phone_code_hash")
        return sent

    async def sign_in(self, phone: str, code_hash: str, code: str) -> dict[str, Any]:
        return self._session(
            await self._call("auth_sign_in", phone_number=phone, phone_code=code, phone_code_hash=code_hash)
        )

    async def check_password(self, password: str) -> dict[str, Any]:
        return self._session(await self._call("auth_check_password", password=password))

    async def qr_login(self) -> dict[str, Any]:
        """A new QR code ({url, expires}) or, once it is scanned, the session; SESSION_PASSWORD_NEEDED on 2FA.

        The same calls as GoyGram's own QR login (goygram.security._mt_qr_auth_flow)."""
        self.app.mt.qr_update_ev.clear()  # a scan of an older code must not count for this one
        res = await self._call("auth_export_login_token", except_ids=[])
        if res.get("type") == "loginTokenMigrateTo":  # the account lives on another DC: log in there
            dc = res["dc_id"]
            await _switch_dc(self.app, dc)
            res = {"dc_id": dc, **await self._call("auth_import_login_token", token=res["token"])}
        if res.get("type") == "loginToken":
            token = base64.urlsafe_b64encode(res["token"]).decode().rstrip("=")
            return {"url": f"tg://login?token={token}", "expires": res["expires"]}
        return self._session(res)

    def scanned(self) -> bool:
        """Telegram sent updateLoginToken: the QR code was scanned."""
        ev = self.app.mt.qr_update_ev
        scanned: bool = ev.is_set()
        ev.clear()
        return scanned

    def _session(self, final: dict[str, Any]) -> dict[str, Any]:
        """The vault payload GoyGram writes after its own login, minus the phone and API data."""
        user, key = _extract_user(final), _extract_auth_blob(final) or self.app.mt.auth_key
        if user is None or key is None:
            raise RuntimeError("Telegram did not return the user or the auth key")
        return {
            "user": user,
            "auth_key": key.hex(),
            "server_salt": self.app.mt.server_salt.hex(),
            "dc": _field(final, "dc_id", "dc") or _current_dc_id(self.app),
        }

    async def close(self) -> None:
        await self.app.mt.close()


async def _switch_dc(app: Any, dc: int) -> None:
    """Reconnect to another DC with a new auth key, as GoyGram does on auth.loginTokenMigrateTo."""
    try:
        endpoint = await asyncio.to_thread(pick_reachable_dc, get_dynamic_dc_config(), preferred_dc=dc)
    except Exception:  # noqa: BLE001  the same fallback as goygram.security._mt_req_with_migrate
        endpoint = pick_dc_endpoint(get_dynamic_dc_config(), preferred_dc=dc)
    mt = app.mt
    await mt.close()
    mt.stop_ev.clear()
    mt.host, mt.port, mt._preferred_dc = endpoint.host, endpoint.port, dc
    mt.auth_key, mt.seq, mt._init_done = None, 0, False
    mt.session_id = secrets.token_bytes(8)
    await mt.boot()
    await mt.ensure_auth_key()
    await mt.ensure_reader()
    log.info("QR login moved to dc%s", dc)


async def connect(api_id: int, api_hash: str) -> GoyGramLogin:
    # The constructor probes data centres with blocking sockets; persist=False: the session goes to the DB.
    session = Session("login", persist=False)
    return GoyGramLogin(
        await asyncio.to_thread(
            GoyGram, api_id=api_id, api_hash=api_hash, session_name="login", session=session, **CLIENT
        )
    )


PAGE = 200  # channels.getParticipants page, as in goygram


class MembersClient(GoyGram):
    vault: Path
    mt: Any  # GoyGram's stub leaves its transport out
    _typed_peer: Callable[[Any, str], Awaitable[dict[str, Any]]]  # private, so the stub leaves it out too
    home: tuple[Any, bytes | None]  # the stored session's DC and auth key

    def at_home(self) -> bool:
        """Still on the stored session's DC with its key (goygram may move it, see Account._rejected)."""
        return (_current_dc_id(self), self.mt.auth_key) == self.home

    async def run(self) -> None:
        try:
            await super().run()
        finally:
            shutil.rmtree(self.vault.parent, ignore_errors=True)  # logout or restart: no session copy on disk

    async def alive(self) -> None:
        """updates.getState, the lightest call; retry=0: a FLOOD_WAIT is reported, not slept on."""
        # Before run() restores the session a call would make a fresh, unauthorised key (and a false 401).
        if self.mt.reader_task is None:
            raise TimeoutError("the session is not restored yet")
        await self.mt.call("updates.getState", retry=0)

    async def members(self, chat_id: int) -> AsyncIterator[dict[str, Any]]:
        """GoyGram's iter_participants, plus each member's names and username: it drops the response's users."""
        # shortcut: participants[].user_id / users[].id shape is unverified against a live account
        peer = await self._typed_peer(self.raw_chat(chat_id), "channel")  # ValueError for a basic group
        offset = 0
        while True:
            res = await self.mt_req(
                "channels.getParticipants", channel=peer,
                filter={"_": "channelParticipantsSearch", "q": ""}, offset=offset, limit=PAGE, hash=0,
            )
            res = res["result"] if isinstance(res.get("result"), dict) else res
            page = res.get("participants") or []
            users = {u["id"]: u for u in res.get("users") or [] if u.get("id") is not None}
            for p in page:
                u = users.get(p["user_id"], {})
                yield {"user_id": p["user_id"], **{k: u.get(k) for k in ("first_name", "last_name", "username")}}
            if len(page) < PAGE:
                return
            offset += len(page)

    async def end_session(self) -> None:
        if err := _extract_error(await self.mt_req("auth.logOut")):
            raise rpc_error(400, err)


async def open_client(api_id: int, api_hash: str, data: dict[str, Any]) -> GoyGram:
    """The user client for a stored session: GoyGram restores a session only from its vault file."""
    # One client per process: earlier vaults are left by a killed process (SIGTERM skips run()'s cleanup).
    for old in Path(tempfile.gettempdir()).glob("members-*"):
        shutil.rmtree(old, ignore_errors=True)
    vault = Path(tempfile.mkdtemp(prefix="members-")) / "members.vault"  # mkdtemp: 0700, this client only
    session = Session("members", data=data, path=vault)
    session.save()
    try:
        client = await asyncio.to_thread(
            MembersClient, api_id=api_id, api_hash=api_hash, session_name="members", session=session, **CLIENT
        )
    except BaseException:
        shutil.rmtree(vault.parent, ignore_errors=True)
        raise
    client.vault, client.home = vault, (data.get("dc"), _extract_auth_blob(data))
    return client
