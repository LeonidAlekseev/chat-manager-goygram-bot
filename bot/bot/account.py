"""The MTProto user account behind /all and member lists: login steps from the panel, and its client."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import asyncpg
from goygram.errors import FloodWaitError

from bot.mention import NO_SESSION, MentionError
from bot.settings import _open, decrypt, encrypt, load_settings

log = logging.getLogger(__name__)

# Taking the step clears it with its input, so a code or password never stays in the DB.
CLAIM = (
    "UPDATE mtproto_login l SET step = NULL, input = NULL, error = NULL, updated_at = now() "
    "FROM (SELECT step, input FROM mtproto_login WHERE id = 1 FOR UPDATE) old "
    "WHERE l.id = 1 AND old.step IS NOT NULL RETURNING old.step, old.input"
)


# An error Telegram lets the user retry within the same login; any other starts the login over.
RETRY = {"code": "PHONE_CODE_INVALID", "password": "PASSWORD_HASH_INVALID"}
REASONS = {
    "PHONE_CODE_INVALID": "Неверный код.",
    "PASSWORD_HASH_INVALID": "Неверный пароль.",
    "PHONE_CODE_EXPIRED": "Код просрочен, запросите новый.",
    "PHONE_NUMBER_INVALID": "Неверный номер телефона.",
    "PHONE_NUMBER_BANNED": "Номер заблокирован в Telegram.",
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
            await self.step(row["step"], decrypt(row["input"], self.secret))
        session = await self.db.fetchval("SELECT api_session FROM settings WHERE id = 1")
        if session != self._session:  # a login, or «Выйти» in the panel
            await self._stop_client()
            self._session = session
            if plain := _open(session, self.secret):
                s = await load_settings(self.db, self.secret)
                self.client = await self.open_client(s.api_id, s.api_hash, json.loads(plain))  # type: ignore[arg-type]
                self._task = asyncio.create_task(self.client.run())
                self._task.add_done_callback(_log_client_stop)

    async def stop(self) -> None:
        await self._drop()
        await self._stop_client()

    async def _stop_client(self) -> None:
        task, self._task, self.client = self._task, None, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def step(self, step: str, value: str) -> None:
        try:
            await self._step(step, value)
        except Exception as e:  # noqa: BLE001  any failure must reach the panel, not stop the loop
            if "SESSION_PASSWORD_NEEDED" in str(e):
                return await self._report("password")
            if RETRY.get(step, "-") in str(e):
                return await self._report(step, reason(e))
            log.warning("login step %s failed: %r", step, e)
            await self._drop()
            await self._report(None, reason(e))

    async def _step(self, step: str, value: str) -> None:
        if step == "phone":
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

    async def _drop(self) -> None:
        if self.login is not None:
            login, self.login = self.login, None
            await login.close()

    async def _report(self, state: str | None, error: str | None = None) -> None:
        await self.db.execute(
            "UPDATE mtproto_login SET state = $1, error = $2, updated_at = now() WHERE id = 1", state, error
        )


def _log_client_stop(task: "asyncio.Task[None]") -> None:
    if not task.cancelled():
        log.error("user client stopped: %r", task.exception() or "exited")
