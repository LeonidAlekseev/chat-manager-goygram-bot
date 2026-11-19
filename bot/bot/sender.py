import asyncio
from typing import Any, Protocol

from bot.mention import DEFAULT_TEXT, build_mention_messages, fetch_user_ids

FETCH_TIMEOUT = 30  # a hung MTProto call must not stall the sequential scheduler
SEND_TIMEOUT = 60  # per Bot API call: GoyGram sleeps through 429s for up to 5×300 s


class Telegram(Protocol):
    """The slice of GoyGram the sender needs; returns the Bot API result, raises on API errors."""

    async def bot_req(self, meth: str, /, **kw: Any) -> Any: ...


async def _req(tg: Telegram, meth: str, **kw: Any) -> Any:
    try:
        return await asyncio.wait_for(tg.bot_req(meth, **kw), SEND_TIMEOUT)
    except TimeoutError:
        raise TimeoutError(f"Отправка не завершилась за {SEND_TIMEOUT} с (возможно, отправлено)") from None


async def send_template(tg: Telegram, chat_id: int, t: Any, user: Any = None) -> dict[str, Any]:
    """Sends one template to one chat; returns the sent Bot API Message.

    `t` is a templates row (kind, text, options, anonymous, multiple, mention_all, correct_option_id,
    explanation, source_chat_id, source_message_ids). An album (several source messages) goes out as one
    album with copyMessages, and the first of its messages is returned.
    With mention_all, a poll or copy is followed by a separate mention message; a text carries the mentions itself.
    A mention failure, or an album some of whose sources were deleted, never fails the send: it is
    returned as `mention_error` in the message (logged as the send's error text).
    A mention poll also returns the members it fetched as `member_ids`; other polls fetch none here,
    so the send is not held up (the caller snapshots their members after all sends).
    """
    mentions: list[str] = []
    error = None
    partial = None
    ids: list[int] = []
    poll = t["kind"] == "poll"
    copy = t["kind"] == "copy"
    if t["mention_all"]:
        try:
            ids = await fetch_members(user, chat_id)
            # a copy's text is only a preview, so its mentions go out under the default text
            mentions = build_mention_messages(DEFAULT_TEXT if copy else t["text"], ids)
        except Exception as e:  # noqa: BLE001  MentionError or a Telegram/MTProto failure
            error = str(e) or type(e).__name__
    if poll:
        msg = await _req(tg, 
            "sendPoll",
            chat_id=chat_id,
            question=t["text"],
            options=[{"text": o} for o in t["options"]],
            is_anonymous=t["anonymous"],
            allows_multiple_answers=t["multiple"],
            **({"type": "quiz", "correct_option_id": t["correct_option_id"], "explanation": t["explanation"]}
               if t["correct_option_id"] is not None else {}),
        )
    elif copy and len(src := t["source_message_ids"]) > 1:
        sent = await _req(tg, "copyMessages", chat_id=chat_id, from_chat_id=t["source_chat_id"], message_ids=src)
        if not sent:
            raise RuntimeError("Сообщения альбома удалены")
        msg = sent[0]
        if len(sent) < len(src):
            partial = f"Отправлено {len(sent)} из {len(src)} сообщений альбома"
    elif copy:
        msg = await _req(tg, "copyMessage", chat_id=chat_id, from_chat_id=t["source_chat_id"], message_id=src[0])
    elif mentions:
        msg = await _req(tg, "sendMessage", chat_id=chat_id, text=mentions.pop(0), parse_mode="HTML")
    else:
        msg = await _req(tg, "sendMessage", chat_id=chat_id, text=t["text"])
    for part in mentions:
        try:
            await _req(tg, "sendMessage", chat_id=chat_id, text=part, parse_mode="HTML")
        except Exception as e:  # noqa: BLE001
            error = str(e)
            break
    error = "; ".join(e for e in (partial, error) if e) or None
    extra = {**({"mention_error": error} if error else {}), **({"member_ids": ids} if poll and ids else {})}
    return {**msg, **extra}


async def fetch_members(user: Any, chat_id: int) -> list[int]:
    return await asyncio.wait_for(fetch_user_ids(user, chat_id), FETCH_TIMEOUT)
