import pytest

from bot.polls import ROW_OVERHEAD, handle_poll, handle_poll_answer, purge_journals


@pytest.fixture(autouse=True)
async def _clean(db):
    await db.execute("TRUNCATE poll_answers, poll_members, poll_results")  # no FK to chats: the cascade misses them


def poll_answer(poll_id: str, user_id: int, option_ids: list[int], **user) -> dict:
    # Shape of a Bot API update as GoyGram passes it in Obj.raw["raw"].
    return {
        "update_id": 1,
        "poll_answer": {
            "poll_id": poll_id,
            "user": {"id": user_id, "first_name": "Анна", "last_name": "К", **user},
            "option_ids": option_ids,
        },
    }


async def answers(db):
    return [tuple(r) for r in await db.fetch("SELECT poll_id, user_id, name, option_ids FROM poll_answers ORDER BY user_id")]


async def test_answer_is_saved_with_the_user_name(db):
    await handle_poll_answer(db, poll_answer("p1", 5, [0, 2]))
    assert await answers(db) == [("p1", 5, "Анна К", [0, 2])]


async def test_changed_answer_updates_the_row(db):
    await handle_poll_answer(db, poll_answer("p1", 5, [0]))
    await handle_poll_answer(db, poll_answer("p1", 5, [1]))
    assert await answers(db) == [("p1", 5, "Анна К", [1])]


async def test_retracted_vote_keeps_the_row_with_no_options(db):
    await handle_poll_answer(db, poll_answer("p1", 5, [0]))
    await handle_poll_answer(db, poll_answer("p1", 5, []))
    assert await answers(db) == [("p1", 5, "Анна К", [])]


async def test_users_and_polls_are_kept_apart(db):
    await handle_poll_answer(db, poll_answer("p1", 5, [0]))
    await handle_poll_answer(db, poll_answer("p1", 6, [1], first_name="Борис", last_name=None))
    await handle_poll_answer(db, poll_answer("p2", 5, [1]))
    assert len(await answers(db)) == 3
    assert await db.fetchval("SELECT name FROM poll_answers WHERE user_id = 6") == "Борис"


async def test_other_updates_are_ignored(db):
    await handle_poll_answer(db, {"update_id": 2, "message": {}})
    assert await answers(db) == []


async def test_vote_from_an_anonymous_voter_chat_is_ignored(db):
    await handle_poll_answer(db, {"poll_answer": {"poll_id": "p1", "voter_chat": {"id": -1}, "option_ids": [0]}})
    assert await answers(db) == []


async def test_duplicate_update_keeps_one_row(db):
    await handle_poll_answer(db, poll_answer("p1", 5, [0]))
    await handle_poll_answer(db, poll_answer("p1", 5, [0]))
    assert await answers(db) == [("p1", 5, "Анна К", [0])]


async def test_answer_of_a_user_missing_from_the_member_snapshot_is_saved(db):
    await db.execute("INSERT INTO poll_members (poll_id, user_id) VALUES ('p1', 1)")
    await handle_poll_answer(db, poll_answer("p1", 5, [1], first_name=None, last_name=None, username="new"))
    assert await answers(db) == [("p1", 5, "new", [1])]


def poll_update(poll_id: str, anonymous: bool, counts: list[int]) -> dict:
    # Sent on every vote change of a poll the bot sent; the only results an anonymous poll gives.
    options = [{"text": f"o{i}", "voter_count": c} for i, c in enumerate(counts)]
    return {"update_id": 3, "poll": {"id": poll_id, "question": "q", "options": options, "is_anonymous": anonymous,
                                     "total_voter_count": sum(counts), "is_closed": False, "type": "regular"}}


async def results(db):
    return [tuple(r) for r in await db.fetch("SELECT poll_id, anonymous, counts FROM poll_results ORDER BY poll_id")]


async def test_poll_update_stores_anonymity_and_counts(db):
    await handle_poll(db, poll_update("p1", True, [2, 0]))
    await handle_poll(db, poll_update("p1", True, [2, 1]))
    await handle_poll(db, poll_update("p2", False, [1]))
    assert await results(db) == [("p1", True, [2, 1]), ("p2", False, [1])]


async def test_poll_update_is_not_an_answer_and_an_answer_is_not_a_poll_update(db):
    await handle_poll_answer(db, poll_update("p1", True, [1]))
    await handle_poll(db, poll_answer("p1", 5, [0]))
    assert await answers(db) == [] and await results(db) == []


async def test_retention_deletes_answers_and_members_older_than_a_year(db):
    await db.execute(
        "INSERT INTO poll_answers (poll_id, user_id, name, option_ids, updated_at) VALUES "
        "('old', 1, 'a', '{0}', now() - interval '366 days'), ('new', 1, 'a', '{0}', now() - interval '364 days')"
    )
    await db.execute(
        "INSERT INTO poll_members (poll_id, user_id, created_at) VALUES "
        "('old', 1, now() - interval '366 days'), ('new', 1, now() - interval '364 days')"
    )
    await purge_journals(db)
    assert [r[0] for r in await db.fetch("SELECT poll_id FROM poll_answers")] == ["new"]
    assert [r[0] for r in await db.fetch("SELECT poll_id FROM poll_members")] == ["new"]


async def test_retention_deletes_finished_sends_older_than_a_year_but_never_a_pending_one(db):
    chat = await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-1, 'c') RETURNING id")
    await db.execute(
        "INSERT INTO send_logs (chat_id, slot, status, created_at) VALUES "
        "($1, now(), 'sent', now() - interval '366 days'), ($1, now(), 'pending', now() - interval '366 days'), "
        "($1, now(), 'error', now() - interval '364 days')", chat)
    await purge_journals(db)
    assert sorted(r[0] for r in await db.fetch("SELECT status::text FROM send_logs")) == ["error", "pending"]


async def test_size_cap_deletes_the_oldest_rows_until_the_rest_fits(db):
    await db.execute(
        "INSERT INTO poll_members (poll_id, user_id, created_at) VALUES "
        "('a', 1, now() - interval '3 days'), ('b', 1, now() - interval '2 days'), ('c', 1, now() - interval '1 day')")
    row = await db.fetchval("SELECT pg_column_size(x.*) FROM poll_members x LIMIT 1") + ROW_OVERHEAD
    await purge_journals(db, cap=2 * row)
    assert [r[0] for r in await db.fetch("SELECT poll_id FROM poll_members ORDER BY poll_id")] == ["b", "c"]
    await purge_journals(db, cap=10**12)  # under the cap: nothing more goes
    assert await db.fetchval("SELECT count(*) FROM poll_members") == 2


async def test_size_cap_keeps_pending_jobs_and_never_orphans_a_queued_job(db):
    chat = await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-1, 'c') RETURNING id")
    done, queued, claimed = [
        await db.fetchval("INSERT INTO outbox (chat_id, text, created_at) VALUES ($1, 't', now() - interval '2 days') "
                          "RETURNING id", chat) for _ in range(3)]
    await db.execute(
        "INSERT INTO send_logs (chat_id, slot, status, outbox_id, created_at) VALUES "
        "($1, now(), 'sent', $2, now() - interval '2 days'), ($1, now(), 'pending', $3, now() - interval '2 days')",
        chat, done, claimed)
    await purge_journals(db, cap=1)
    # a job without a log row would be sent again by the outbox, so the queued one and the pending claim stay
    assert sorted(r[0] for r in await db.fetch("SELECT id FROM outbox")) == [queued, claimed]
    assert [r[0] for r in await db.fetch("SELECT status::text FROM send_logs")] == ["pending"]
