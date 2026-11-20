import asyncio
import hashlib
import logging
import os
import re
import sys
from collections.abc import Callable
from typing import Any
from zoneinfo import ZoneInfo

import asyncpg
from goygram import GoyGram

from bot.account import Account, connect, open_client
from bot.admins import run_forever as run_admin_checks_forever
from bot.chats import handle_group_migration, handle_member_update, register_chat
from bot.commands import BOT_COMMANDS, reply_for
from bot.discover import run_forever as run_discover_forever
from bot.intake import handle_edit, handle_private
from bot.link import handle_link_start
from bot.mention import handle_all
from bot.outbox import run_forever as run_outbox_forever
from bot.photos import queue_photo
from bot.photos import run_forever as run_photos_forever
from bot.polls import handle_poll, handle_poll_answer, purge_forever
from bot.scheduler import run_forever
from bot.settings import Settings, store_bot_username, vault_key, wait_for_token, watch_settings

log = logging.getLogger(__name__)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for handler in logging.root.handlers:  # handler filters also see records of child loggers (goygram's)
        handler.addFilter(RedactTokens())
    db = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    secret = os.environ["AUTH_SECRET"]
    # The user client's vault in /tmp; the vault is rewritten from the DB on each start, so no new login.
    os.environ.setdefault("GOYGRAM_VAULT_KEY", vault_key(secret))
    try:
        settings, app = await start_bot(db, secret)
        await _serve(db, secret, settings, app)
    except Exception as e:
        # Shown on the panel's Settings page; a crash loop is otherwise invisible.
        await store_error(db, e)
        raise
    finally:
        await db.close()


def redact(text: str) -> str:
    """Error text without bot tokens (123456:ABC…), e.g. in Bot API URLs …/bot<token>/getMe."""
    return re.sub(r"\d+:[\w-]{30,}", "***", text)


class RedactTokens(logging.Filter):
    """Masks bot tokens in a log line and its traceback: Bot API errors quote URLs with /bot<token>/."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg, record.args = redact(record.getMessage()), None
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


def offset_path(token: str) -> str | None:
    """Long-polling offset on a volume (OFFSET_DIR), so a restart does not get the last updates again.

    One file per token, as GoyGram's default: a new bot must not start from the old bot's offset.
    """
    folder = os.environ.get("OFFSET_DIR")
    return f"{folder}/{hashlib.sha256(token.encode()).hexdigest()[:24]}.offset" if folder else None


async def store_error(db: asyncpg.Pool, e: Exception) -> None:
    await db.execute("UPDATE settings SET bot_error = $1 WHERE id = 1", redact(str(e) or type(e).__name__))


async def start_bot(
    db: asyncpg.Pool, secret: str, make_app: Callable[..., Any] = GoyGram, interval: float = 5
) -> tuple[Settings, Any]:
    """Waits for a token the Bot API accepts: a rejected one is shown in the panel until it is replaced."""
    while True:
        settings = await wait_for_token(db, secret, interval)
        app = make_app(bot_token=settings.bot_token, bot_offset_path=offset_path(settings.bot_token or ""))
        try:
            await store_bot_username(db, app)
            commands = [{"command": c, "description": d} for c, d in BOT_COMMANDS]
            await app.bot_req("setMyCommands", commands=commands)
        except Exception as e:
            await app.core.close()
            # GoyGram reports Bot API errors as "botapi <method> http <status>: …"; 401/404 = bad token.
            if not re.search(r"http 40[14]\b", str(e)):
                raise
            log.error("Telegram rejected the bot token: %s", redact(str(e)))
            await store_error(db, e)
            await watch_settings(db, secret, settings, interval)
            continue
        await db.execute("UPDATE settings SET bot_error = NULL WHERE id = 1")
        return settings, app


def register_polls(app: Any, db: asyncpg.Pool) -> None:
    # allowed_updates=[] (GoyGram's default) is Telegram's default set, which includes poll_answer and poll.
    @app.on_update
    async def on_update(evt):  # type: ignore[no-untyped-def]
        if evt.update_type == "poll_answer":
            await handle_poll_answer(db, evt.raw["raw"])

    @app.on_poll
    async def on_poll(evt):  # type: ignore[no-untyped-def]
        await handle_poll(db, evt.raw["raw"])


async def _serve(db: asyncpg.Pool, secret: str, settings: Settings, app: Any) -> None:
    # Members need a user account (MTProto), logged in from the panel; without it /all replies with an error.
    user = Account(db, secret, connect=connect, open_client=open_client)

    @app.on_msg
    async def on_msg(msg):  # type: ignore[no-untyped-def]
        message = msg.raw["raw"].get("message")
        if not message:
            return
        await handle_group_migration(db, message)
        await register_chat(db, message)
        await queue_photo(db, message)
        await handle_all(db, app, user, message)
        text = await handle_link_start(db, message) or await handle_private(db, message, os.environ.get("PANEL_URL"))
        if text is None:
            text = reply_for(message)
        if text:
            await msg.respond(text, parse_mode="HTML")

    @app.on_edit
    async def on_edit(msg):  # type: ignore[no-untyped-def]
        if (message := msg.raw["raw"].get("edited_message")) and message["chat"]["type"] == "private":
            await handle_edit(db, message)

    @app.on_member
    async def on_member(evt):  # type: ignore[no-untyped-def]
        await handle_member_update(db, evt.raw["raw"])

    register_polls(app, db)
    account = asyncio.create_task(user.run())  # login steps, the user client, the bot's heartbeat
    tz = ZoneInfo(os.environ.get("TIMEZONE_NAME") or "Europe/Moscow")
    # read before our own heartbeat; the column is UTC without a zone, like every Prisma DateTime
    seen = await db.fetchval("SELECT bot_seen_at AT TIME ZONE 'UTC' FROM settings WHERE id = 1")
    scheduler = asyncio.create_task(run_forever(db, app, tz, user, seen))
    outbox = asyncio.create_task(run_outbox_forever(db, app, user))
    discovery = asyncio.create_task(run_discover_forever(db, user))  # «Найти группы бота» in the panel
    retention = asyncio.create_task(purge_forever(db))
    # «Вы не администратор» in the panel; start_bot already passed getMe, bot_req works without polling
    admin_checks = asyncio.create_task(run_admin_checks_forever(db, app))
    photos = asyncio.create_task(run_photos_forever(db, app))  # chat photos for the panel (#113)
    runner = asyncio.create_task(app.run())
    # New token or API data: exit and let compose (restart: unless-stopped) start us with them.
    watcher = asyncio.create_task(watch_settings(db, secret, settings))
    try:
        done, _ = await asyncio.wait({runner, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            log.info("settings changed in the panel, restarting")
        else:
            runner.result()  # re-raise a crash of the bot itself
            # GoyGram's run() returns on its own only after getUpdates got 401/404 and polling stopped.
            raise RuntimeError("Токен бота отклонён Telegram: проверьте токен в Настройках")
    finally:
        runner.cancel()
        watcher.cancel()
        account.cancel()
        await user.stop()
        scheduler.cancel()
        outbox.cancel()
        discovery.cancel()
        retention.cancel()
        admin_checks.cancel()
        photos.cancel()


def run() -> None:
    try:
        asyncio.run(main())
    except Exception:
        log.exception("bot stopped")  # through RedactTokens: the default excepthook would print the token
        sys.exit(1)


if __name__ == "__main__":
    run()
