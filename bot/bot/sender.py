from typing import Any, Protocol


class Telegram(Protocol):
    """The slice of GoyGram the sender needs; returns the Bot API result, raises on API errors."""

    async def bot_req(self, meth: str, /, **kw: Any) -> Any: ...


async def send_template(tg: Telegram, chat_id: int, t: Any) -> dict[str, Any]:
    """Sends one template to one chat; returns the sent Bot API Message.

    `t` is a templates row (kind, text, options, anonymous, multiple, mention_all).
    """
    if t["kind"] == "poll":
        return await tg.bot_req(  # type: ignore[no-any-return]
            "sendPoll",
            chat_id=chat_id,
            question=t["text"],
            options=[{"text": o} for o in t["options"]],
            is_anonymous=t["anonymous"],
            allows_multiple_answers=t["multiple"],
        )
    return await tg.bot_req("sendMessage", chat_id=chat_id, text=t["text"])  # type: ignore[no-any-return]
