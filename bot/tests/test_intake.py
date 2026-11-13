import pytest

from bot.intake import REFUSAL, handle_private

URL = "https://panel.example.com/"


def msg(user_id: int = 42, chat_type: str = "private", **extra) -> dict:
    return {"message_id": 7, "chat": {"id": user_id, "type": chat_type}, "from": {"id": user_id}, **extra}


@pytest.fixture
async def manager(db):
    await db.execute("TRUNCATE managers RESTART IDENTITY CASCADE")
    return await db.fetchval(
        "INSERT INTO managers (login, password_hash, telegram_user_id) VALUES ('m1', 'x', 42) RETURNING id")


async def only(db):
    return dict(await db.fetchrow("SELECT * FROM templates"))


async def test_poll_becomes_a_non_anonymous_poll_template(db, manager):
    poll = {"question": "Смена открыта?", "options": [{"text": "Да"}, {"text": "Нет"}], "type": "quiz",
            "allows_multiple_answers": True, "is_anonymous": True, "correct_option_id": 0}
    reply = await handle_private(db, msg(poll=poll), URL)
    t = await only(db)
    assert (t["kind"], t["name"], t["text"], t["options"], t["anonymous"], t["multiple"], t["author_id"]) == (
        "poll", "Смена открыта?", "Смена открыта?", ["Да", "Нет"], False, True, manager)
    assert t["source_message_id"] is None
    assert "Смена открыта?" in reply and "https://panel.example.com/templates" in reply


async def test_any_other_message_becomes_a_copy_template(db, manager):
    reply = await handle_private(db, msg(text="Не забудьте ключ от кассы сегодня обязательно вечером"), URL)
    t = await only(db)
    assert (t["kind"], t["name"], t["text"], t["source_chat_id"], t["source_message_id"], t["media_type"]) == (
        "copy", "Не забудьте ключ от кассы сегодня", "Не забудьте ключ от кассы сегодня обязательно вечером",
        42, 7, "text")
    assert t["author_id"] == manager and "/templates" in reply


async def test_media_uses_the_caption_and_falls_back_to_the_media_type(db, manager):
    await handle_private(db, msg(photo=[{}], caption="График на неделю"), URL)
    await handle_private(db, msg(voice={}), URL)
    rows = await db.fetch("SELECT name, text, media_type FROM templates ORDER BY id")
    assert [tuple(r) for r in rows] == [("График на неделю", "График на неделю", "photo"), ("Голосовое", "", "voice")]


async def test_reply_has_no_link_without_panel_url(db, manager):
    reply = await handle_private(db, msg(text="привет"), None)
    assert reply and "http" not in reply


async def test_unlinked_or_disabled_user_is_refused_and_nothing_is_saved(db, manager):
    assert await handle_private(db, msg(user_id=99, text="привет"), URL) == REFUSAL
    await db.execute("UPDATE managers SET active = false")
    assert await handle_private(db, msg(text="привет"), URL) == REFUSAL
    assert await db.fetchval("SELECT count(*) FROM templates") == 0


async def test_unlinked_forward_still_returns_the_sender_id(db, manager):
    fwd = msg(user_id=99, text="hi", forward_origin={"type": "user", "sender_user": {"id": 777}})
    assert "777" in await handle_private(db, fwd, URL)


async def test_commands_and_groups_are_not_templates(db, manager):
    assert await handle_private(db, msg(text="/start"), URL) is None
    assert await handle_private(db, msg(text="hi", chat_type="supergroup"), URL) is None
    assert await db.fetchval("SELECT count(*) FROM templates") == 0
