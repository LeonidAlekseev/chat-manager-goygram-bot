import asyncio
import logging
import os
from zoneinfo import ZoneInfo

import asyncpg
from goygram import GoyGram

from bot.chats import handle_group_migration, handle_member_update
from bot.commands import BOT_COMMANDS, reply_for
from bot.mention import handle_all
from bot.outbox import run_forever as run_outbox_forever
from bot.polls import handle_poll_answer, purge_forever
from bot.scheduler import run_forever
from bot.settings import store_bot_username, wait_for_token, watch_settings

log = logging.getLogger(__name__)


def _log_user_stop(task: "asyncio.Task[None]") -> None:
    if not task.cancelled():
        log.error("user client stopped: %r", task.exception() or "exited")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    db = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    secret = os.environ["AUTH_SECRET"]
    settings = await wait_for_token(db, secret)
    app = GoyGram(bot_token=settings.bot_token)
    # Members need a user account (MTProto), separate from the bot; without it /all replies with an error.
    user = (
        GoyGram(api_id=settings.api_id, api_hash=settings.api_hash, session_name="members")
        if settings.api_id and settings.api_hash
        else None
    )

    # run() performs the MTProto login (interactive on first start); iter_participants needs it connected.
    user_task = asyncio.create_task(user.run()) if user else None
    if user_task:
        user_task.add_done_callback(_log_user_stop)

    @app.on_msg
    async def on_msg(msg):  # type: ignore[no-untyped-def]
        message = msg.raw["raw"].get("message")
        if not message:
            return
        await handle_group_migration(db, message)
        await handle_all(app, user, message)
        text = reply_for(message)
        if text:
            await msg.respond(text, parse_mode="HTML")

    @app.on_member
    async def on_member(evt):  # type: ignore[no-untyped-def]
        await handle_member_update(db, evt.raw["raw"])

    # allowed_updates=[] (GoyGram's default) is Telegram's default set, which includes poll_answer.
    @app.on_update
    async def on_update(evt):  # type: ignore[no-untyped-def]
        if evt.update_type == "poll_answer":
            await handle_poll_answer(db, evt.raw["raw"])

    await store_bot_username(db, app)
    await app.bot_req("setMyCommands", commands=[{"command": c, "description": d} for c, d in BOT_COMMANDS])
    tz = ZoneInfo(os.environ.get("TIMEZONE_NAME") or "Europe/Moscow")
    # GoyGram's bot_req stub is a set of per-method overloads that mypy won't match to the Protocol.
    scheduler = asyncio.create_task(run_forever(db, app, tz, user))  # type: ignore[arg-type]
    outbox = asyncio.create_task(run_outbox_forever(db, app, user))  # type: ignore[arg-type]
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
        if user_task:
            user_task.cancel()
        scheduler.cancel()
        outbox.cancel()
        retention.cancel()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
