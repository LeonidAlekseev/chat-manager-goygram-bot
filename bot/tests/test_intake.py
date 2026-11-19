import pytest

from bot.intake import REFUSAL, handle_edit, handle_private

URL = "https://panel.example.com/"


def msg(user_id: int = 42, chat_type: str = "private", message_id: int = 7, **extra) -> dict:
    return {"message_id": message_id, "chat": {"id": user_id, "type": chat_type}, "from": {"id": user_id}, **extra}


@pytest.fixture
async def manager(db):
    await db.execute("TRUNCATE managers RESTART IDENTITY CASCADE")
    return await db.fetchval(
        "INSERT INTO managers (login, password_hash, telegram_user_id) VALUES ('m1', 'x', 42) RETURNING id")


async def only(db):
    return dict(await db.fetchrow("SELECT * FROM templates"))


async def test_poll_becomes_a_poll_template_as_it_was(db, manager):
    poll = {"question": "Смена открыта?", "options": [{"text": "Да"}, {"text": "Нет"}], "type": "regular",
            "allows_multiple_answers": True, "is_anonymous": False}
    reply = await handle_private(db, msg(poll=poll), URL)
    t = await only(db)
    assert (t["kind"], t["name"], t["text"], t["options"], t["anonymous"], t["multiple"], t["author_id"]) == (
        "poll", "Смена открыта?", "Смена открыта?", ["Да", "Нет"], False, True, manager)
    assert (t["source_chat_id"], t["source_message_ids"], t["correct_option_id"], t["explanation"]) == (
        42, [7], None, None)
    assert "Смена открыта?" in reply and "https://panel.example.com/templates" in reply


async def test_quiz_keeps_its_answer_explanation_and_anonymity(db, manager):
    poll = {"question": "2+2?", "options": [{"text": "3"}, {"text": "4"}], "type": "quiz",
            "allows_multiple_answers": False, "is_anonymous": True, "correct_option_id": 1, "explanation": "Счёт"}
    await handle_private(db, msg(poll=poll), URL)
    t = await only(db)
    assert (t["anonymous"], t["multiple"], t["correct_option_id"], t["explanation"]) == (True, False, 1, "Счёт")


async def test_any_other_message_becomes_a_copy_template(db, manager):
    reply = await handle_private(db, msg(text="Не забудьте ключ от кассы сегодня обязательно вечером"), URL)
    t = await only(db)
    assert (t["kind"], t["name"], t["text"], t["source_chat_id"], t["source_message_ids"], t["media_type"]) == (
        "copy", "Не забудьте ключ от кассы сегодня", "Не забудьте ключ от кассы сегодня обязательно вечером",
        42, [7], "text")
    assert t["author_id"] == manager and f'href="https://panel.example.com/templates?id={t["id"]}#t-{t["id"]}"' in reply


async def test_media_uses_the_caption_and_falls_back_to_the_media_type(db, manager):
    await handle_private(db, msg(photo=[{}], caption="График на неделю"), URL)
    await handle_private(db, msg(message_id=8, voice={}), URL)
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


async def test_album_becomes_one_template_with_all_its_messages(db, manager):
    first = await handle_private(db, msg(message_id=8, media_group_id="g1", photo=[{}]), URL)
    rest = await handle_private(db, msg(message_id=7, media_group_id="g1", video={}, caption="Отчёт за смену"), URL)
    t = await only(db)
    assert (t["name"], t["text"], t["media_type"], t["source_message_ids"]) == (
        "Отчёт за смену", "Отчёт за смену", "album", [7, 8])
    assert "Альбом" in first and rest == ""


async def test_editing_the_source_message_updates_the_preview_and_an_auto_name(db, manager):
    await handle_private(db, msg(text="Старый текст"), URL)
    await handle_private(db, msg(message_id=8, text="Второй"), URL)
    await handle_private(db, msg(message_id=9, media_group_id="g1", photo=[{}]), URL)
    await db.execute("UPDATE templates SET name = 'Из панели' WHERE id = 2")
    await handle_edit(db, msg(text="Новый текст", edit_date=1))
    await handle_edit(db, msg(message_id=8, text="Второй исправлен", edit_date=1))
    await handle_edit(db, msg(message_id=9, media_group_id="g1", photo=[{}], caption="Подпись", edit_date=1))
    rows = await db.fetch("SELECT name, text FROM templates ORDER BY id")
    assert [tuple(r) for r in rows] == [
        ("Новый текст", "Новый текст"), ("Из панели", "Второй исправлен"), ("Подпись", "Подпись")]


async def test_editing_an_album_item_without_a_caption_changes_nothing(db, manager):
    await handle_private(db, msg(message_id=8, media_group_id="g1", photo=[{}], caption="Отчёт"), URL)
    await handle_private(db, msg(message_id=9, media_group_id="g1", photo=[{}]), URL)
    await handle_edit(db, msg(message_id=9, media_group_id="g1", photo=[{}], edit_date=1))
    t = await only(db)
    assert (t["name"], t["text"]) == ("Отчёт", "Отчёт")


async def test_album_from_a_stranger_is_refused_once(db, manager):
    replies = [await handle_private(db, msg(user_id=99, message_id=i, media_group_id="g9", photo=[{}]), URL)
               for i in (1, 2, 3)]
    assert replies == [REFUSAL, "", ""]
    assert await db.fetchval("SELECT count(*) FROM templates") == 0


async def test_a_message_delivered_again_after_a_restart_makes_no_second_template(db, manager):
    poll = {"question": "Смена открыта?", "options": [{"text": "Да"}, {"text": "Нет"}]}
    for m in (msg(text="Ключ от кассы"), msg(message_id=8, poll=poll)):
        assert await handle_private(db, m, URL)
        assert await handle_private(db, m, URL) == ""  # Telegram repeats updates whose offset was lost
    assert await db.fetchval("SELECT count(*) FROM templates") == 2
