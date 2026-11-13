import pytest

from bot.polls import handle_poll_answer


@pytest.fixture(autouse=True)
async def _clean(db):
    await db.execute("TRUNCATE poll_answers")  # no FK to chats, so the db fixture's cascade misses it


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
