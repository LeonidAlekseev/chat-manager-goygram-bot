import html
from typing import Any

import asyncpg

from bot.commands import reply_for

REFUSAL = "Сохранять шаблоны могут только менеджеры с привязанным Telegram (привязка — в профиле панели)."
# Message fields that name the media kind, in the order they are checked.
MEDIA = {
    "photo": "Фото", "video": "Видео", "animation": "GIF", "document": "Документ", "voice": "Голосовое",
    "audio": "Аудио", "video_note": "Кружок", "sticker": "Стикер", "contact": "Контакт", "location": "Геопозиция",
    "venue": "Место", "dice": "Кубик",
}
NAME_WORDS = 6


def _copy_fields(message: dict[str, Any]) -> tuple[str, str, str]:
    """(name, preview, media_type) of a non-poll message."""
    preview = (message.get("text") or message.get("caption") or "").strip()
    media = next((k for k in MEDIA if k in message), "text" if "text" in message else "message")
    name = " ".join(preview.split()[:NAME_WORDS])[:255] or MEDIA.get(media, "Сообщение")
    return name, preview, media


async def handle_private(db: asyncpg.Pool, message: dict[str, Any], panel_url: str | None) -> str | None:
    """Reply to a private non-command message: a linked manager's message becomes a template.

    A poll becomes a (non-anonymous) poll template, anything else a `copy` template that is sent with
    copyMessage. Others are refused, except that a forwarded user still gets their ID (see reply_for).
    """
    if message["chat"]["type"] != "private" or (message.get("text") or "").startswith("/"):
        return None
    author = await db.fetchval(
        "SELECT id FROM managers WHERE telegram_user_id = $1 AND active", message["from"]["id"])
    if author is None:
        return reply_for(message) or REFUSAL
    if poll := message.get("poll"):
        name = text = poll["question"]
        await db.execute(
            "INSERT INTO templates (name, kind, text, options, anonymous, multiple, author_id) "
            "VALUES ($1, 'poll', $2, $3, false, $4, $5)",
            name[:255], text, [o["text"] for o in poll["options"]], bool(poll.get("allows_multiple_answers")), author)
    else:
        name, text, media = _copy_fields(message)
        await db.execute(
            "INSERT INTO templates (name, kind, text, source_chat_id, source_message_id, media_type, author_id) "
            "VALUES ($1, 'copy', $2, $3, $4, $5, $6)",
            name, text, message["chat"]["id"], message["message_id"], media, author)
    link = f'\n<a href="{panel_url.rstrip("/")}/templates">Открыть в панели</a>' if panel_url else ""
    return f"Шаблон «{html.escape(name, quote=False)}» сохранён.{link}"

