from typing import Any

START_TEXT = """<b>Команды бота:</b>
/all – Позвать всех [GROUP]
/chatid – Узнать чат ID [GROUP]
/myid – Узнать свой ID [PRIVATE]
/start – Запуск бота [PRIVATE]

Перешлите сообщение в личку, чтобы узнать ID отправителя."""

# (command, description) for setMyCommands; /all is handled in a later ticket.
BOT_COMMANDS = [
    ("chatid", "Узнать чат ID [GROUP]"),
    ("myid", "Узнать свой ID [PRIVATE]"),
    ("start", "Запуск бота [PRIVATE]"),
]


def _command(text: str) -> str | None:
    if not text.startswith("/"):
        return None
    return text.split()[0][1:].split("@")[0].lower()


def reply_for(message: dict[str, Any]) -> str | None:
    """HTML reply for an incoming Bot API message, or None to stay silent."""
    private = message["chat"]["type"] == "private"
    cmd = _command(message.get("text") or "")
    if private:
        if cmd == "start":
            return START_TEXT
        if cmd == "myid":
            return f"<b>User ID:</b> <code>{message['from']['id']}</code>"
        origin = message.get("forward_origin")
        if origin and origin.get("type") == "user":
            return f"<b>User ID:</b> <code>{origin['sender_user']['id']}</code>"
        if origin and origin.get("type") == "hidden_user":
            return "Пользователь скрыл свой аккаунт при пересылке — ID недоступен."
        return None
    if cmd == "chatid":
        return f"<b>Chat ID:</b> <code>{message['chat']['id']}</code>"
    return None
