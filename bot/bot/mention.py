import html
from typing import Any

DEFAULT_TEXT = "Сообщение для всех"
MAX_LEN = 4096  # Bot API limit, counted after entity parsing: a hidden link is 1 char
MAX_ENTITIES = 100  # Telegram caps entities per message
ADMIN_STATUSES = {"creator", "administrator"}
NO_SESSION = "Не настроен аккаунт для списка участников: задайте API_ID и API_HASH в панели (Настройки)."
BASIC_GROUP = "Список участников доступен только для супергрупп; обычную группу нужно преобразовать в супергруппу."


class MentionError(Exception):
    """User-facing reason why mentions could not be sent."""


def build_mention_messages(text: str, user_ids: list[int]) -> list[str]:
    """HTML messages: the text followed by hidden links; the text is repeated in every part."""
    if not user_ids:
        return []
    text = html.escape(text, quote=False)  # shortcut: length counted escaped, slightly pessimistic
    per = min(MAX_ENTITIES, MAX_LEN - len(text))
    if per < 1:
        raise MentionError("Текст слишком длинный, чтобы добавить упоминания.")
    return [
        text + "".join(f'<a href="tg://user?id={u}">&#8205;</a>' for u in user_ids[i : i + per])
        for i in range(0, len(user_ids), per)
    ]


async def fetch_user_ids(user: Any, chat_id: int) -> list[int]:
    if user is None:
        raise MentionError(NO_SESSION)
    try:
        # shortcut: participant shape (dict with user_id) is unverified against a live account
        return [p["user_id"] async for p in user.iter_participants(chat_id)]
    except ValueError as e:  # goygram raises ValueError for non-channel chats
        raise MentionError(BASIC_GROUP) from e


async def mention_all(bot: Any, user: Any, chat_id: int, text: str | None, reply_to: int | None = None) -> None:
    ids = await fetch_user_ids(user, chat_id)
    extra = {"reply_parameters": {"message_id": reply_to}} if reply_to else {}
    for part in build_mention_messages(text or DEFAULT_TEXT, ids):
        await bot.bot_req("sendMessage", chat_id=chat_id, text=part, parse_mode="HTML", **extra)


async def _say(bot: Any, chat_id: int, text: str) -> None:
    await bot.bot_req("sendMessage", chat_id=chat_id, text=html.escape(text, quote=False))


async def handle_all(bot: Any, user: Any, message: dict[str, Any]) -> None:
    """`/all [text]` in a group: admins only; a reply makes the mentions answer that message."""
    parts = (message.get("text") or "").split(maxsplit=1)
    if not parts or parts[0][1:].split("@")[0].lower() != "all" or not parts[0].startswith("/"):
        return
    chat_id = message["chat"]["id"]
    if message["chat"]["type"] == "private":
        return
    member = await bot.bot_req("getChatMember", chat_id=chat_id, user_id=message["from"]["id"])
    # shortcut: bot_req may or may not unwrap "result"; unverified live
    if member.get("result", member).get("status") not in ADMIN_STATUSES:
        return await _say(bot, chat_id, "Команда доступна только администраторам чата.")
    reply = (message.get("reply_to_message") or {}).get("message_id")
    try:
        await mention_all(bot, user, chat_id, parts[1] if len(parts) > 1 else None, reply)
    except MentionError as e:
        await _say(bot, chat_id, str(e))
