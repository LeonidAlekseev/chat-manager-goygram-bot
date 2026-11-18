from datetime import UTC, datetime

from bot.chats import delete_chats, handle_group_migration, handle_member_update


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


D1, D2 = datetime(2026, 3, 1, 5, tzinfo=UTC), datetime(2026, 3, 2, 5, tzinfo=UTC)


async def test_migration_keeps_the_better_log_of_a_slot_both_rows_have(db):
    await db.execute("TRUNCATE schedules, templates CASCADE")
    t = await db.fetchval("INSERT INTO templates (name, kind, text) VALUES ('Ключ', 'text', 'Ключ') RETURNING id")
    sid = await db.fetchval("INSERT INTO schedules (name) VALUES ('Смена') RETURNING id")
    item = await db.fetchval(
        "INSERT INTO schedule_items (schedule_id, template_id, time) VALUES ($1, $2, '08:00') RETURNING id", sid, t)
    old = await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-555, 'Старая') RETURNING id")
    new = await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-100555, 'Новая') RETURNING id")
    await db.executemany(
        "INSERT INTO send_logs (chat_id, schedule_item_id, slot, status, message_id) "
        "VALUES ($1, $2, $3, $4::\"SendStatus\", $5)",
        [(old, item, D1, "error", None), (new, item, D1, "sent", 7),
         (old, item, D2, "sent", 8), (new, item, D2, "pending", None)],
    )
    await handle_group_migration(db, {"chat": {"id": -555}, "migrate_to_chat_id": -100555})
    rows = await db.fetch("SELECT chat_id, status::text, message_id FROM send_logs ORDER BY slot")
    assert [tuple(r) for r in rows] == [(old, "sent", 7), (old, "sent", 8)]


class LeavingTelegram:
    def __init__(self, error: str | None = None):
        self.calls: list[tuple[str, dict]] = []
        self.error = error

    async def bot_req(self, meth: str, **kw):
        self.calls.append((meth, kw))
        if self.error:
            raise RuntimeError(self.error)
        return True


async def test_deleted_chat_is_left_and_removed_with_its_journal_and_jobs(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await handle_member_update(db, my_chat_member(-100777, "Остаётся", "member"))
    chat_id = await db.fetchval("SELECT id FROM chats WHERE telegram_id = -100123")
    await db.execute("INSERT INTO outbox (chat_id, text) VALUES ($1, 'ещё не отправлено')", chat_id)
    await db.execute("INSERT INTO send_logs (chat_id, slot, status) VALUES ($1, now(), 'sent')", chat_id)
    await db.execute("UPDATE chats SET deleting = true WHERE id = $1", chat_id)
    tg = LeavingTelegram()
    await delete_chats(db, tg)
    assert tg.calls == [("leaveChat", {"chat_id": -100123})]
    assert await chats(db) == [(-100777, "Остаётся", True)]
    assert await db.fetchval("SELECT count(*) FROM outbox") == 0
    assert await db.fetchval("SELECT count(*) FROM send_logs") == 0


async def test_chat_the_bot_already_left_is_removed_without_leaving(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "kicked"))
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "kicked"))
    await db.execute("UPDATE chats SET deleting = true")
    tg = LeavingTelegram()
    await delete_chats(db, tg)
    assert tg.calls == [] and await chats(db) == []


async def test_telegram_saying_the_bot_is_not_there_still_removes_the_chat(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await db.execute("UPDATE chats SET deleting = true")
    await delete_chats(db, LeavingTelegram("botapi leaveChat http 400: Bad Request: chat not found"))
    assert await chats(db) == []


async def test_network_failure_keeps_the_chat_for_the_next_try(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await db.execute("UPDATE chats SET deleting = true")
    await delete_chats(db, LeavingTelegram("connection reset"))
    assert await chats(db) == [(-100123, "ПВЗ", True)]


async def test_leave_update_after_deletion_does_not_bring_the_chat_back(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await db.execute("UPDATE chats SET deleting = true")
    await delete_chats(db, LeavingTelegram())
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "left"))
    assert await chats(db) == []
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))  # added back later: a new chat
    assert [tuple(r) for r in await db.fetch("SELECT active, deleting, schedule_id FROM chats")] == [(True, False, None)]


async def test_chat_with_a_send_in_flight_waits_for_the_next_pass(db):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await db.execute("INSERT INTO send_logs (chat_id, slot) SELECT id, now() FROM chats")  # pending
    await db.execute("UPDATE chats SET deleting = true")
    tg = LeavingTelegram()
    await delete_chats(db, tg)
    assert tg.calls == [] and len(await chats(db)) == 1
    await db.execute("UPDATE send_logs SET status = 'sent'")
    await delete_chats(db, tg)
    assert await chats(db) == []


async def test_a_failing_leave_is_logged_once_not_every_tick(db, caplog):
    await handle_member_update(db, my_chat_member(-100123, "ПВЗ", "member"))
    await db.execute("UPDATE chats SET deleting = true")
    for _ in range(3):
        await delete_chats(db, LeavingTelegram("connection reset"))
    assert len([r for r in caplog.records if "leaving chat" in r.message]) == 1
    await delete_chats(db, LeavingTelegram())
    assert await chats(db) == []
