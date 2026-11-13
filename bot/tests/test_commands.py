from bot.commands import reply_for


def msg(text: str = "", chat_type: str = "private", **extra) -> dict:
    return {"message_id": 1, "chat": {"id": -100555 if chat_type != "private" else 42, "type": chat_type},
            "from": {"id": 42}, "text": text, **extra}


def test_start_lists_commands_in_private():
    reply = reply_for(msg("/start"))
    assert "/myid" in reply and "/chatid" in reply and "/all" in reply


def test_myid_returns_sender_id():
    assert reply_for(msg("/myid")) == "<b>User ID:</b> <code>42</code>"


def test_forwarded_message_in_private_returns_original_sender_id():
    fwd = msg("hi", forward_origin={"type": "user", "sender_user": {"id": 777}})
    assert reply_for(fwd) == "<b>User ID:</b> <code>777</code>"


def test_forward_from_hidden_user_explains_why_no_id():
    fwd = msg("hi", forward_origin={"type": "hidden_user", "sender_user_name": "Anon"})
    assert reply_for(fwd) == "Пользователь скрыл свой аккаунт при пересылке — ID недоступен."


def test_chatid_in_group_with_bot_mention():
    assert reply_for(msg("/chatid@goy_bot", "supergroup")) == "<b>Chat ID:</b> <code>-100555</code>"


def test_private_commands_are_silent_in_groups_and_vice_versa():
    assert reply_for(msg("/myid", "group")) is None
    assert reply_for(msg("/chatid")) is None
    assert reply_for(msg("просто текст", "group")) is None
