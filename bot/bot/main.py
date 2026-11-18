import asyncio
import logging
import os
import re
from collections.abc import Callable
from typing import Any
from zoneinfo import ZoneInfo

import asyncpg
from goygram import GoyGram

from bot.account import Account, connect, open_client
from bot.chats import handle_group_migration, handle_member_update
from bot.commands import BOT_COMMANDS, reply_for
from bot.intake import handle_edit, handle_private
from bot.link import handle_link_start
from bot.mention import handle_all
from bot.outbox import run_forever as run_outbox_forever
from bot.polls import handle_poll_answer, purge_forever
from bot.scheduler import run_forever
from bot.settings import Settings, store_bot_username, vault_key, wait_for_token, watch_settings

log = logging.getLogger(__name__)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
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


async def store_error(db: asyncpg.Pool, e: Exception) -> None:
    await db.execute("UPDATE settings SET bot_error = $1 WHERE id = 1", redact(str(e) or type(e).__name__))


async def start_bot(
    db: asyncpg.Pool, secret: str, make_app: Callable[..., Any] = GoyGram, interval: float = 5
) -> tuple[Settings, Any]:
    """Waits for a token the Bot API accepts: a rejected one is shown in the panel until it is replaced."""
    while True:
        settings = await wait_for_token(db, secret, interval)
        app = make_app(bot_token=settings.bot_token)
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


async def _serve(db: asyncpg.Pool, secret: str, settings: Settings, app: Any) -> None:
    # Members need a user account (MTProto), logged in from the panel; without it /all replies with an error.
    user = Account(db, secret, connect=connect, open_client=open_client)

    @app.on_msg
    async def on_msg(msg):  # type: ignore[no-untyped-def]
        message = msg.raw["raw"].get("message")
        if not message:
            return
        await handle_group_migration(db, message)
        await handle_all(app, user, message)
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

    # allowed_updates=[] (GoyGram's default) is Telegram's default set, which includes poll_answer.
    @app.on_update
    async def on_update(evt):  # type: ignore[no-untyped-def]
        if evt.update_type == "poll_answer":
            await handle_poll_answer(db, evt.raw["raw"])

    account = asyncio.create_task(user.run())  # login steps, the user client, the bot's heartbeat
    tz = ZoneInfo(os.environ.get("TIMEZONE_NAME") or "Europe/Moscow")
    # read before our own heartbeat; the column is UTC without a zone, like every Prisma DateTime
    seen = await db.fetchval("SELECT bot_seen_at AT TIME ZONE 'UTC' FROM settings WHERE id = 1")
    scheduler = asyncio.create_task(run_forever(db, app, tz, user, seen))
    outbox = asyncio.create_task(run_outbox_forever(db, app, user))
    retention = asyncio.create_task(purge_forever(db))
    runner = asyncio.create_task(app.run())
    # New token or API data: exit and let compose (restart: unless-stopped) start us with them.
    watcher = asyncio.create_task(watch_settings(db, secret, settings))
    try:
        done, _ = await asyncio.wait({runner, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            log.info("settings changed in the panel, restarting")
        else:
            runner.result()  # re-raise a crash of the bot itself
    finally:
        runner.cancel()
        watcher.cancel()
        account.cancel()
        await user.stop()
        scheduler.cancel()
        outbox.cancel()
        retention.cancel()


if __name__ == "__main__":
    asyncio.run(main())
