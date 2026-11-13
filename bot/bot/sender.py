from typing import Any, Protocol

from bot.mention import build_mention_messages, fetch_user_ids


class Telegram(Protocol):
    """The slice of GoyGram the sender needs; returns the Bot API result, raises on API errors."""

    async def bot_req(self, meth: str, /, **kw: Any) -> Any: ...


async def send_template(tg: Telegram, chat_id: int, t: Any, user: Any = None) -> dict[str, Any]:
    """Sends one template to one chat; returns the sent Bot API Message.

    `t` is a templates row (kind, text, options, anonymous, multiple, mention_all). With mention_all,
    a poll is followed by a separate mention message; a text carries the mentions itself.
    A mention failure never fails the send: it is returned as `mention_error` in the message.
    """
    mentions: list[str] = []
    error = None
    if t["mention_all"]:
        try:
            mentions = build_mention_messages(t["text"], await fetch_user_ids(user, chat_id))
        except Exception as e:  # noqa: BLE001  MentionError or a Telegram/MTProto failure
            error = str(e)
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
    return {**msg, "mention_error": error} if error else msg
