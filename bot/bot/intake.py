import html
from collections import deque
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
# (chat, media_group_id) of albums already refused: their other items get no reply.
_refused_albums: deque[tuple[int, str]] = deque(maxlen=100)


def _auto_name(preview: str, media: str) -> str:
    fallback = "Альбом" if media == "album" else "Сообщение"
    return " ".join(preview.split()[:NAME_WORDS])[:255] or MEDIA.get(media, fallback)


def _copy_fields(message: dict[str, Any]) -> tuple[str, str, str]:
    """(name, preview, media_type) of a non-poll message; an album item has media_type `album`."""
    preview = (message.get("text") or message.get("caption") or "").strip()
    if "media_group_id" in message:
        media = "album"
    else:
        media = next((k for k in MEDIA if k in message), "text" if "text" in message else "message")
    return _auto_name(preview, media), preview, media


async def handle_private(db: asyncpg.Pool, message: dict[str, Any], panel_url: str | None) -> str | None:
    """Reply to a private non-command message: a linked manager's message becomes a template.

    A poll becomes a poll template as it was (a quiz keeps its answer), anything else a `copy` template
    that is sent with copyMessage(s). The items of an album (one media_group_id) arrive as separate
    messages and are collected into one template; only the first gets a reply, the rest get "" (silence).
    Others are refused, except that a forwarded user still gets their ID (see reply_for).
    """
    if message["chat"]["type"] != "private" or (message.get("text") or "").startswith("/"):
        return None
    author = await db.fetchval(
        "SELECT id FROM managers WHERE telegram_user_id = $1 AND active", message["from"]["id"])
    if author is None:
        if gid := message.get("media_group_id"):
            if (key := (message["chat"]["id"], gid)) in _refused_albums:
                return ""
            _refused_albums.append(key)
        return reply_for(message) or REFUSAL
    if poll := message.get("poll"):
        name = text = poll["question"]
        tid = await db.fetchval(
            "INSERT INTO templates "
            "(name, kind, text, options, anonymous, multiple, correct_option_id, explanation, author_id) "
            "VALUES ($1, 'poll', $2, $3, $4, $5, $6, $7, $8) RETURNING id",
            name[:255], text, [o["text"] for o in poll["options"]], bool(poll.get("is_anonymous")),
            bool(poll.get("allows_multiple_answers")), poll.get("correct_option_id"), poll.get("explanation"), author)
    else:
        name, text, media = _copy_fields(message)
        # The first album item creates the template, the rest add their ids (copyMessages wants them sorted)
        # and the first caption; NULL media_group_id never conflicts.
        tid, created = await db.fetchrow(
            "INSERT INTO templates "
            "(name, kind, text, source_chat_id, source_message_ids, media_group_id, media_type, author_id) "
            "VALUES ($1, 'copy', $2, $3, ARRAY[$4::bigint], $5, $6, $7) "
            "ON CONFLICT (source_chat_id, media_group_id) DO UPDATE SET "
            "source_message_ids = ARRAY(SELECT DISTINCT unnest(templates.source_message_ids || $4::bigint) ORDER BY 1), "
            "name = CASE templates.text WHEN '' THEN EXCLUDED.name ELSE templates.name END, "
            "text = CASE templates.text WHEN '' THEN EXCLUDED.text ELSE templates.text END "
            "RETURNING id, xmax = 0",
            name, text, message["chat"]["id"], message["message_id"], message.get("media_group_id"), media, author)
        if not created:
            return ""
    link = f'\n<a href="{panel_url.rstrip("/")}/templates?id={tid}#t-{tid}">Открыть в панели</a>' if panel_url else ""
    return f"Шаблон «{html.escape(name, quote=False)}» сохранён.{link}"


async def handle_edit(db: asyncpg.Pool, message: dict[str, Any]) -> None:
    """An edited source message refreshes its copy template's preview (the send copies the message as it
    is now) and its name, unless the name was changed in the panel. An album item without a caption
    changes nothing: the caption may be on another item."""
    name, text, media = _copy_fields(message)
    if media == "album" and not text:
        return
    rows = await db.fetch(
        "SELECT id, name, text, media_type FROM templates "
        "WHERE kind = 'copy' AND source_chat_id = $1 AND $2 = ANY(source_message_ids)",
        message["chat"]["id"], message["message_id"])
    for r in rows:
        auto = r["name"] == _auto_name(r["text"], r["media_type"])
        await db.execute(
            "UPDATE templates SET name = $2, text = $3 WHERE id = $1", r["id"], name if auto else r["name"], text)
