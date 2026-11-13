"""The MTProto user account behind /all and member lists: login steps from the panel, and its client."""

import asyncio
import json
import logging
import shutil
import tempfile
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import asyncpg
from goygram import GoyGram
from goygram.errors import FloodWaitError, rpc_error
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


# An error Telegram lets the user retry within the same login; any other starts the login over.
RETRY = {"code": "PHONE_CODE_INVALID", "password": "PASSWORD_HASH_INVALID"}
REASONS = {
    "PHONE_CODE_INVALID": "Неверный код.",
    "PASSWORD_HASH_INVALID": "Неверный пароль.",
    "PHONE_CODE_EXPIRED": "Код просрочен, запросите новый.",
    "PHONE_NUMBER_INVALID": "Неверный номер телефона.",
    "PHONE_NUMBER_BANNED": "Номер заблокирован в Telegram.",
    "API_ID_INVALID": "Неверные API ID или API HASH: проверьте их на my.telegram.org.",
}


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
        self.client: Any = None
        self._task: asyncio.Task[None] | None = None
        self._session: str | None = None  # the stored ciphertext the client runs with

    def iter_participants(self, chat_id: int) -> AsyncIterator[Any]:
        if self.client is None:
            raise MentionError(NO_SESSION)
        it: AsyncIterator[Any] = self.client.iter_participants(chat_id)
        return it

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
        session = await self.db.fetchval("SELECT api_session FROM settings WHERE id = 1")
        if session != self._session:  # a login, or «Выйти» in the panel
            await self._stop_client()
            if plain := _open(session, self.secret):
                s = await load_settings(self.db, self.secret)
                self.client = await self.open_client(s.api_id, s.api_hash, json.loads(plain))  # type: ignore[arg-type]
                self._task = asyncio.create_task(self.client.run())
                self._task.add_done_callback(_log_client_stop)
            self._session = session  # only now: a failed start is retried on the next tick

    async def stop(self) -> None:
        await self._drop()
        await self._stop_client()

    async def _stop_client(self) -> None:
        task, self._task, self.client = self._task, None, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def step(self, step: str, cipher: str) -> None:
        try:
            await self._step(step, decrypt(cipher, self.secret))
        except Exception as e:  # noqa: BLE001  any failure must reach the panel, not stop the loop
            if "SESSION_PASSWORD_NEEDED" in str(e):
                return await self._report("password")
            if RETRY.get(step, "-") in str(e):
                return await self._report(step, reason(e))
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
            self.phone, self.code_hash = value, await self.login.send_code(value)
            await self._report("code")
        elif self.login is None:
            await self._report(None, "Вход прерван, запросите код заново.")
        elif step == "code":
            await self._finish(await self.login.sign_in(self.phone, self.code_hash, value))
        elif step == "password":
            await self._finish(await self.login.check_password(value))

    async def _finish(self, session: dict[str, Any]) -> None:
        user = session["user"]
        name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")]))
        if user.get("username"):
            name += f" (@{user['username']})"
        await self.db.execute(
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
        if self.login is not None:
            login, self.login = self.login, None
            await login.close()

    async def _report(self, state: str | None, error: str | None = None) -> None:
        await self.db.execute(
            "UPDATE mtproto_login SET step = NULL, state = $1, error = $2, updated_at = now() WHERE id = 1", state, error
        )


# shortcut: a stopped client (crash, session ended in Telegram) is only logged; the panel still shows the
# account. Clear api_session here if admins need to see it, but not on transient network errors.
def _log_client_stop(task: "asyncio.Task[None]") -> None:
    if not task.cancelled():
        log.error("user client stopped: %r", task.exception() or "exited")


# GoyGram adapters. GoyGram's own phone login (goygram.security._mt_auth_flow) reads stdin, so the steps
# below repeat its calls one at a time with its private helpers.
# Private goygram API: goygram is pinned exactly in pyproject.toml; re-check these imports when upgrading it.
class GoyGramLogin:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def _call(self, act: str, **kw: Any) -> dict[str, Any]:
        # retry=0: surface FLOOD_WAIT to the panel instead of sleeping on it; DC migration is still handled.
        res = await _mt_req_with_migrate(self.app, act, retry=0, **kw)
        if err := _extract_error(res):  # GoyGram returns some RPC errors as dicts instead of raising
            raise rpc_error(400, err)
        return res

    async def send_code(self, phone: str) -> str:
        settings = _extension().serialize_constructor("codeSettings", {"flags": 0})
        code_hash = _extract_phone_code_hash(await self._call("auth_send_code", phone_number=phone, settings=settings))
        if not code_hash:
            raise RuntimeError("auth.sendCode did not return phone_code_hash")
        return str(code_hash)

    async def sign_in(self, phone: str, code_hash: str, code: str) -> dict[str, Any]:
        return self._session(
            await self._call("auth_sign_in", phone_number=phone, phone_code=code, phone_code_hash=code_hash)
        )

    async def check_password(self, password: str) -> dict[str, Any]:
        return self._session(await self._call("auth_check_password", password=password))

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


async def connect(api_id: int, api_hash: str) -> GoyGramLogin:
    # The constructor probes data centres with blocking sockets; persist=False: the session goes to the DB.
    session = Session("login", persist=False)
    return GoyGramLogin(
        await asyncio.to_thread(GoyGram, api_id=api_id, api_hash=api_hash, session_name="login", session=session)
    )


class MembersClient(GoyGram):
    vault: Path

    async def run(self) -> None:
        try:
            await super().run()
        finally:
            shutil.rmtree(self.vault.parent, ignore_errors=True)  # logout or restart: no session copy on disk

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
            MembersClient, api_id=api_id, api_hash=api_hash, session_name="members", session=session
        )
    except BaseException:
        shutil.rmtree(vault.parent, ignore_errors=True)
        raise
    client.vault = vault
    return client
