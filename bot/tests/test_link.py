from bot.link import handle_link_start, is_linked_manager


def msg(text: str, user_id: int = 42, chat_type: str = "private") -> dict:
    return {"message_id": 1, "chat": {"id": user_id, "type": chat_type}, "from": {"id": user_id}, "text": text}


async def manager(db, login="m1", code="abc", expires="now() + interval '15 minutes'", active=True) -> int:
    return await db.fetchval(
        f"INSERT INTO managers (login, password_hash, active, link_code, link_code_expires_at) "
        f"VALUES ($1, 'x', $2, $3, {expires}) RETURNING id", login, active, code)


async def tg_id(db, login="m1"):
    return await db.fetchval("SELECT telegram_user_id FROM managers WHERE login = $1", login)


async def test_valid_code_links_the_account_and_is_one_time(db):
    await db.execute("DELETE FROM managers")
    await manager(db)
    assert "привяз" in (await handle_link_start(db, msg("/start link_abc"))).lower()
    assert await tg_id(db) == 42
    assert await is_linked_manager(db, 42)
    assert "недействительн" in await handle_link_start(db, msg("/start link_abc", user_id=43))
    assert await tg_id(db) == 42


async def test_expired_unknown_and_disabled_codes_are_refused(db):
    await db.execute("DELETE FROM managers")
    await manager(db, "old", "e1", "now() - interval '1 second'")
    await manager(db, "off", "d1", active=False)
    for code in ("e1", "d1", "nope"):
        assert "недействительн" in await handle_link_start(db, msg(f"/start link_{code}"))
    assert await db.fetchval("SELECT count(*) FROM managers WHERE telegram_user_id IS NOT NULL") == 0


async def test_telegram_account_links_to_one_manager_only(db):
    await db.execute("DELETE FROM managers")
    await manager(db, "a", "c1")
    await manager(db, "b", "c2")
    await handle_link_start(db, msg("/start link_c1"))
    assert "уже привязан" in await handle_link_start(db, msg("/start link_c2"))
    assert await tg_id(db, "b") is None


async def test_disabled_manager_is_not_linked_and_non_link_messages_are_ignored(db):
    await db.execute("DELETE FROM managers")
    await manager(db, "a", "c1")
    await handle_link_start(db, msg("/start link_c1"))
    await db.execute("UPDATE managers SET active = false")
    assert not await is_linked_manager(db, 42)
    assert not await is_linked_manager(db, 999)
    assert await handle_link_start(db, msg("/start")) is None
    assert await handle_link_start(db, msg("/start link_c1", chat_type="group")) is None
