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


async def test_migration_merges_into_a_row_the_supergroup_already_has(db):
    # The bot saw the supergroup (my_chat_member) before the migration message: two rows, one telegram_id each.
    await db.execute("TRUNCATE schedules CASCADE")
    sid = await db.fetchval("INSERT INTO schedules (name) VALUES ('Смена') RETURNING id")
    old = await db.fetchval(
        "INSERT INTO chats (telegram_id, title, active, schedule_id) VALUES (-555, 'Пункт 1', false, $1) RETURNING id", sid)
    new = await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-100555, 'ПВЗ') RETURNING id")
    job = await db.fetchval("INSERT INTO outbox (chat_id, text) VALUES ($1, 'привет') RETURNING id", new)
    await db.execute("INSERT INTO send_logs (chat_id, slot, outbox_id) VALUES ($1, now(), $2)", new, job)
    await handle_group_migration(db, {"chat": {"id": -555, "type": "group"}, "migrate_to_chat_id": -100555})
    rows = await db.fetch("SELECT id, telegram_id, title, active, schedule_id FROM chats")
    assert [tuple(r) for r in rows] == [(old, -100555, "Пункт 1", True, sid)]
    assert await db.fetchval("SELECT chat_id FROM outbox WHERE id = $1", job) == old
    assert await db.fetchval("SELECT chat_id FROM send_logs WHERE outbox_id = $1", job) == old
