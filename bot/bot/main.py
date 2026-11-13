import asyncio
import logging
import os
from zoneinfo import ZoneInfo

import asyncpg
from goygram import GoyGram

from bot.chats import handle_group_migration, handle_member_update
from bot.commands import BOT_COMMANDS, reply_for
from bot.outbox import run_forever as run_outbox_forever
from bot.scheduler import run_forever


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    db = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    app = GoyGram(bot_token=os.environ["BOT_TOKEN"])

    @app.on_msg
    async def on_msg(msg):  # type: ignore[no-untyped-def]
        message = msg.raw["raw"].get("message")
        if not message:
            return
        await handle_group_migration(db, message)
        text = reply_for(message)
        if text:
            await msg.respond(text, parse_mode="HTML")

    @app.on_member
    async def on_member(evt):  # type: ignore[no-untyped-def]
        await handle_member_update(db, evt.raw["raw"])

    await app.bot_req("setMyCommands", commands=[{"command": c, "description": d} for c, d in BOT_COMMANDS])
    tz = ZoneInfo(os.environ.get("TIMEZONE_NAME") or "Europe/Moscow")
    # GoyGram's bot_req stub is a set of per-method overloads that mypy won't match to the Protocol.
    scheduler = asyncio.create_task(run_forever(db, app, tz))  # type: ignore[arg-type]
    outbox = asyncio.create_task(run_outbox_forever(db, app))  # type: ignore[arg-type]
    try:
        await app.run()
    finally:
        scheduler.cancel()
        outbox.cancel()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
