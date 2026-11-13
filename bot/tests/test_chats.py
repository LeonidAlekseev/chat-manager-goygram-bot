from bot.chats import handle_group_migration, handle_member_update


def my_chat_member(chat_id: int, title: str, status: str) -> dict:
    # Shape of a Bot API update as GoyGram passes it in Obj.raw["raw"].
    return {
        "update_id": 1,
        "my_chat_member": {
            "chat": {"id": chat_id, "title": title, "type": "supergroup"},
            "from": {"id": 42},
            "old_chat_member": {"status": "left", "user": {"id": 7}},
            "new_chat_member": {"status": status, "user": {"id": 7}},
        },
    }


async def chats(db):
    return [tuple(r) for r in await db.fetch("SELECT telegram_id, title, active FROM chats ORDER BY id")]


async def test_bot_added_to_group_registers_active_chat(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ Ленина", "member"))
    assert await chats(db) == [(-100123, "ПВЗ Ленина", True)]


async def test_bot_removed_marks_chat_inactive(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "kicked"))
    assert await chats(db) == [(-100123, "ПВЗ", False)]


async def test_readding_bot_reactivates_and_keeps_panel_title(db):
    await handle_member_update(db, my_chat_member(-100123, "Telegram title", "member"))
    await db.execute("UPDATE chats SET title = 'Пункт 1'")  # rename done by the panel
    await handle_member_update(db, my_chat_member(-100123, "Telegram title", "left"))
    await handle_member_update(db, my_chat_member(-100123, "Telegram title", "administrator"))
    assert await chats(db) == [(-100123, "Пункт 1", True)]


async def test_other_member_changes_are_ignored(db):
    await handle_member_update(db, {"update_id": 2, "chat_member": {"chat": {"id": -1}}})
    assert await chats(db) == []


async def test_group_upgraded_to_supergroup_keeps_the_chat_under_its_new_id(db):
    await handle_member_update(db, my_chat_member(-555, "ПВЗ", "member"))
    await handle_group_migration(db, {"chat": {"id": -555, "type": "group"}, "migrate_to_chat_id": -100555})
    assert await chats(db) == [(-100555, "ПВЗ", True)]
