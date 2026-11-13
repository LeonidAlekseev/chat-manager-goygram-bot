import asyncio
import logging
import os

import asyncpg
from goygram import GoyGram

from bot.chats import handle_group_migration, handle_member_update
from bot.commands import BOT_COMMANDS, reply_for
from bot.mention import handle_all


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    db = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    app = GoyGram(bot_token=os.environ["BOT_TOKEN"])
    # Members need a user account (MTProto), separate from the bot; without it /all replies with an error.
    user = (
        GoyGram(api_id=int(os.environ["API_ID"]), api_hash=os.environ["API_HASH"],
                session=os.environ.get("API_SESSION") or None, session_name="members")
        if os.environ.get("API_ID") and os.environ.get("API_HASH")
        else None
    )

    # run() performs the MTProto login (interactive on first start); iter_participants needs it connected.
    user_task = asyncio.create_task(user.run()) if user else None

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

    await app.bot_req("setMyCommands", commands=[{"command": c, "description": d} for c, d in BOT_COMMANDS])
    try:
        await app.run()
    finally:
        if user_task:
            user_task.cancel()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
