from bot.chats import handle_member_update, register_chat
from bot.photos import MAX_BYTES, check_due, queue_photo


class FakeBot:
    """getChat per telegram_id: a dict answer or an exception; download_file per file_id: bytes or an exception."""

    def __init__(self, chats, files=None):
        self.chats, self.files, self.downloads = chats, files or {}, []

    async def bot_req(self, method, **kw):
        assert method == "getChat"
        a = self.chats[kw["chat_id"]]
        if isinstance(a, Exception):
            raise a
        return a

    async def download_file(self, file_id):
        self.downloads.append(file_id)
        a = self.files[file_id]
        if isinstance(a, Exception):
            raise a
        return a


def photo(unique):
    return {"photo": {"small_file_id": f"f-{unique}", "small_file_unique_id": unique}}


async def add_chat(db, telegram_id, **cols):
    return await db.fetchval(
        "INSERT INTO chats (telegram_id, title, active, deleting) VALUES ($1, 't', $2, $3) RETURNING id",
        telegram_id, cols.get("active", True), cols.get("deleting", False),
    )


async def stored(db, chat_id):
    return await db.fetchrow("SELECT unique_id, mime, data FROM chat_photos WHERE chat_id = $1", chat_id)


async def checked(db, chat_id):
    return await db.fetchval("SELECT photo_checked_at FROM chats WHERE id = $1", chat_id)


async def test_new_chat_gets_its_photo(db):
    chat = await add_chat(db, -1)
    bot = FakeBot({-1: photo("u1")}, {"f-u1": b"\xff\xd8jpeg"})
    await check_due(db, bot, pause=0)
    row = await stored(db, chat)
    assert (row["unique_id"], row["mime"], row["data"]) == ("u1", "image/jpeg", b"\xff\xd8jpeg")
    assert await checked(db, chat) is not None


async def test_same_unique_id_is_not_downloaded_again_new_one_is(db):
    chat = await add_chat(db, -1)
    bot = FakeBot({-1: photo("u1")}, {"f-u1": b"one", "f-u2": b"two"})
    await check_due(db, bot, pause=0)
    await db.execute("UPDATE chats SET photo_checked_at = NULL")
    await check_due(db, bot, pause=0)
    assert bot.downloads == ["f-u1"]
    bot.chats[-1] = photo("u2")
    await db.execute("UPDATE chats SET photo_checked_at = NULL")
    await check_due(db, bot, pause=0)
    assert (await stored(db, chat))["data"] == b"two"


async def test_removed_photo_deletes_the_row(db):
    chat = await add_chat(db, -1)
    bot = FakeBot({-1: photo("u1")}, {"f-u1": b"one"})
    await check_due(db, bot, pause=0)
    bot.chats[-1] = {"result": {"id": -1}}  # bot_req may not unwrap "result"
    await db.execute("UPDATE chats SET photo_checked_at = NULL")
    await check_due(db, bot, pause=0)
    assert await stored(db, chat) is None


async def test_oversized_photo_is_not_stored(db):
    chat = await add_chat(db, -1)
    bot = FakeBot({-1: photo("big")}, {"f-big": b"x" * (MAX_BYTES + 1)})
    await check_due(db, bot, pause=0)
    assert await stored(db, chat) is None
    assert await checked(db, chat) is not None  # not downloaded again before the daily pass


async def test_errors_are_retried_later_and_do_not_stop_other_chats(db, caplog):
    failing, other, bad_file = await add_chat(db, -1), await add_chat(db, -2), await add_chat(db, -3)
    bot = FakeBot(
        {-1: RuntimeError("botapi getChat http 400: chat not found"), -2: photo("u2"), -3: photo("u3")},
        {"f-u2": b"two", "f-u3": RuntimeError("botapi download file http 500")},
    )
    await check_due(db, bot, pause=0)
    assert (await stored(db, other))["data"] == b"two"
    assert await stored(db, bad_file) is None
    assert "chat not found" in caplog.text
    # retried in about an hour, not on the next tick and not only tomorrow
    hours = await db.fetchval(
        "SELECT extract(epoch FROM now() - photo_checked_at) / 3600 FROM chats WHERE id = $1", failing
    )
    assert 22 < hours < 24
    await check_due(db, bot, pause=0)
    assert bot.downloads.count("f-u3") == 1


async def test_only_active_chats_daily(db):
    await add_chat(db, -1, active=False)
    await add_chat(db, -2, deleting=True)
    fresh = await add_chat(db, -3)
    stale = await add_chat(db, -4)
    await db.execute("UPDATE chats SET photo_checked_at = now() - interval '1 hour' WHERE id = $1", fresh)
    await db.execute("UPDATE chats SET photo_checked_at = now() - interval '25 hours' WHERE id = $1", stale)
    bot = FakeBot({-4: photo("u4")}, {"f-u4": b"four"})  # any other getChat would raise KeyError
    await check_due(db, bot, pause=0)
    assert (await stored(db, stale))["data"] == b"four"


async def test_photo_change_in_the_group_queues_a_check(db):
    chat = await add_chat(db, -1)
    await db.execute("UPDATE chats SET photo_checked_at = now()")
    await queue_photo(db, {"chat": {"id": -1, "type": "supergroup"}, "text": "hi"})
    assert await checked(db, chat) is not None
    for event in ({"new_chat_photo": [{"file_id": "x"}]}, {"delete_chat_photo": True}):
        await db.execute("UPDATE chats SET photo_checked_at = now()")
        await queue_photo(db, {"chat": {"id": -1, "type": "supergroup"}, **event})
        assert await checked(db, chat) is None


async def test_bot_added_again_queues_a_check(db):
    await register_chat(db, {"chat": {"id": -1, "type": "group", "title": "t"}})
    assert await db.fetchval("SELECT photo_checked_at FROM chats WHERE telegram_id = -1") is None
    await db.execute("UPDATE chats SET photo_checked_at = now(), active = false")
    member = {"chat": {"id": -1, "type": "group"}, "new_chat_member": {"status": "member"}}
    await handle_member_update(db, {"my_chat_member": member})
    assert await db.fetchval("SELECT photo_checked_at FROM chats WHERE telegram_id = -1") is None


async def test_public_username_is_saved_updated_and_cleared(db):
    chat = await add_chat(db, -1)
    name = lambda: db.fetchval("SELECT username FROM chats WHERE id = $1", chat)
    bot = FakeBot({-1: {"username": "goy_chat"}})
    await check_due(db, bot, pause=0)
    assert await name() == "goy_chat"
    bot.chats[-1] = {"username": "renamed", **photo("u1")}
    bot.files["f-u1"] = b"x"
    await db.execute("UPDATE chats SET photo_checked_at = NULL")
    await check_due(db, bot, pause=0)
    assert await name() == "renamed"
    bot.chats[-1] = {**photo("u1")}  # photo unchanged (early return): username still cleared
    await db.execute("UPDATE chats SET photo_checked_at = NULL")
    await check_due(db, bot, pause=0)
    assert await name() is None
