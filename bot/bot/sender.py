import asyncio
from typing import Any, Protocol

from bot.mention import build_mention_messages, fetch_user_ids

FETCH_TIMEOUT = 30  # a hung MTProto call must not stall the sequential scheduler


class Telegram(Protocol):
    """The slice of GoyGram the sender needs; returns the Bot API result, raises on API errors."""

    async def bot_req(self, meth: str, /, **kw: Any) -> Any: ...


async def send_template(tg: Telegram, chat_id: int, t: Any, user: Any = None) -> dict[str, Any]:
    """Sends one template to one chat; returns the sent Bot API Message.

    `t` is a templates row (kind, text, options, anonymous, multiple, mention_all). With mention_all,
    a poll is followed by a separate mention message; a text carries the mentions itself.
    A mention failure never fails the send: it is returned as `mention_error` in the message.
    A poll also returns the fetched chat members as `member_ids` (absent if they could not be fetched).
    """
    mentions: list[str] = []
    error = None
    ids: list[int] = []
    poll = t["kind"] == "poll"
    if t["mention_all"] or (poll and user is not None):  # a poll also snapshots members for "who didn't answer"
        try:
            ids = await asyncio.wait_for(fetch_user_ids(user, chat_id), FETCH_TIMEOUT)
            if t["mention_all"]:
                mentions = build_mention_messages(t["text"], ids)
        except Exception as e:  # noqa: BLE001  MentionError or a Telegram/MTProto failure
            if t["mention_all"]:
                error = str(e) or type(e).__name__
    if t["kind"] == "poll":
        msg = await tg.bot_req(
            "sendPoll",
            chat_id=chat_id,
            question=t["text"],
            options=[{"text": o} for o in t["options"]],
            is_anonymous=t["anonymous"],
            allows_multiple_answers=t["multiple"],
        )
    elif mentions:
        msg = await tg.bot_req("sendMessage", chat_id=chat_id, text=mentions.pop(0), parse_mode="HTML")
    else:
        msg = await tg.bot_req("sendMessage", chat_id=chat_id, text=t["text"])
    for part in mentions:
        try:
            await tg.bot_req("sendMessage", chat_id=chat_id, text=part, parse_mode="HTML")
        except Exception as e:  # noqa: BLE001
            error = str(e)
            break
    extra = {**({"mention_error": error} if error else {}), **({"member_ids": ids} if poll and ids else {})}
    return {**msg, **extra}
