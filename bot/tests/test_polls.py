import pytest

from bot.polls import JOURNAL, handle_poll, handle_poll_answer, journal_sizes, purge_journals


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


async def names(db):
    rows = await db.fetch("SELECT user_id, first_name, last_name, username FROM poll_answers ORDER BY user_id")
    return [tuple(r) for r in rows]


async def test_answer_keeps_first_name_last_name_and_username_apart(db):
    await handle_poll_answer(db, poll_answer("p1", 5, [0], username="anna"))
    await handle_poll_answer(db, poll_answer("p1", 6, [0], first_name="Борис", last_name=None))
    assert await names(db) == [(5, "Анна", "К", "anna"), (6, "Борис", None, None)]


async def test_repeated_answer_updates_the_name_and_username(db):
    await handle_poll_answer(db, poll_answer("p1", 5, [0], username="anna"))
    await handle_poll_answer(db, poll_answer("p1", 5, [1], first_name="Аня", last_name=None))  # username dropped
    assert await names(db) == [(5, "Аня", None, None)]


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


async def test_retention_deletes_poll_rows_older_than_a_year(db):
    await db.execute(
        "INSERT INTO poll_answers (poll_id, user_id, name, option_ids, updated_at) VALUES "
        "('old', 1, 'a', '{0}', now() - interval '366 days'), ('new', 1, 'a', '{0}', now() - interval '364 days')"
    )
    await db.execute(
        "INSERT INTO poll_members (poll_id, user_id, created_at) VALUES "
        "('old', 1, now() - interval '366 days'), ('new', 1, now() - interval '364 days')"
    )
    await db.execute(
        "INSERT INTO poll_results (poll_id, anonymous, counts, updated_at) VALUES "
        "('old', true, '{1}', now() - interval '366 days'), ('new', true, '{1}', now() - interval '364 days')"
    )
    await purge_journals(db)
    for table in ("poll_answers", "poll_members", "poll_results"):
        assert [r[0] for r in await db.fetch(f"SELECT poll_id FROM {table}")] == ["new"], table


async def chat_id(db):
    return await db.fetchval("INSERT INTO chats (telegram_id, title) VALUES (-1, 'c') RETURNING id")


async def test_retention_deletes_finished_sends_older_than_a_year_but_never_a_pending_one(db):
    chat = await chat_id(db)
    await db.execute(
        "INSERT INTO send_logs (chat_id, slot, status, created_at) VALUES "
        "($1, now(), 'sent', now() - interval '366 days'), ($1, now(), 'pending', now() - interval '366 days'), "
        "($1, now(), 'error', now() - interval '364 days')", chat)
    await purge_journals(db)
    assert sorted(r[0] for r in await db.fetch("SELECT status::text FROM send_logs")) == ["error", "pending"]


async def test_a_finished_log_takes_its_outbox_job_with_it_by_the_log_time(db):
    chat = await chat_id(db)
    job = await db.fetchval("INSERT INTO outbox (chat_id, text) VALUES ($1, 't') RETURNING id", chat)  # created now
    await db.execute("INSERT INTO send_logs (chat_id, slot, status, outbox_id, created_at) "
                     "VALUES ($1, now(), 'sent', $2, now() - interval '366 days')", chat, job)
    await purge_journals(db)
    assert await db.fetchval("SELECT count(*) FROM outbox") == 0
    assert await db.fetchval("SELECT count(*) FROM send_logs") == 0


def sizes(**bytes_: int) -> dict[str, int]:
    """Fake on-disk sizes: every journal table empty except the given ones."""
    return {t: bytes_.get(t, 0) for t in JOURNAL}


async def test_size_cap_deletes_the_oldest_rows_until_the_real_size_fits(db):
    await db.execute(
        "INSERT INTO poll_members (poll_id, user_id, created_at) VALUES "
        "('a', 1, now() - interval '3 days'), ('b', 1, now() - interval '2 days'), ('c', 1, now() - interval '1 day')")
    # 300 bytes on disk for 3 rows = 100 a row; trimming to 90% of 250 (225) frees 75+, i.e. the oldest row
    await purge_journals(db, cap=250, sizes=sizes(poll_members=300))
    assert [r[0] for r in await db.fetch("SELECT poll_id FROM poll_members ORDER BY poll_id")] == ["b", "c"]
    await purge_journals(db, cap=10**12)  # under the cap: nothing more goes
    assert await db.fetchval("SELECT count(*) FROM poll_members") == 2


async def test_rows_that_stay_do_not_count_as_freed(db):
    chat = await chat_id(db)
    await db.execute(
        "INSERT INTO send_logs (chat_id, slot, status, created_at) VALUES "
        "($1, now(), 'pending', now() - interval '3 days'), ($1, now(), 'sent', now() - interval '2 days'), "
        "($1, now(), 'sent', now() - interval '1 day')", chat)
    # the oldest row is pending: it stays, so freeing 75+ bytes takes the next one
    await purge_journals(db, cap=250, sizes=sizes(send_logs=300))
    assert sorted(r[0] for r in await db.fetch("SELECT status::text FROM send_logs")) == ["pending", "sent"]


async def test_size_cap_keeps_pending_jobs_and_never_orphans_a_queued_job(db):
    chat = await chat_id(db)
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


async def test_size_cap_on_real_sizes_trims_once_and_a_second_run_deletes_nothing(db):
    # ~50k poll rows of the last days, well over a small cap; real on-disk sizes, nothing faked
    await db.execute(
        "INSERT INTO poll_members (poll_id, user_id, created_at) "
        "SELECT 'p' || i, i, now() - i * interval '1 second' FROM generate_series(1, 50000) i")
    cap = sum((await journal_sizes(db)).values()) // 2
    await purge_journals(db, cap=cap)
    left = await db.fetchval("SELECT count(*) FROM poll_members")
    assert 0 < left < 50000
    assert sum((await journal_sizes(db)).values()) <= cap
    await purge_journals(db, cap=cap)
    assert await db.fetchval("SELECT count(*) FROM poll_members") == left
