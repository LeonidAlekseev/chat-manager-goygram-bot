import pytest

from bot.migrate_legacy import migrate

SHIFTS = {
    "shifts": [
        {
            "name": "Смена 08:00",
            "items": [
                {"mid": "10", "name": "Опрос", "time": "08:00", "period": "day"},
                {"mid": "11", "name": "Заметка", "time": "09:15", "period": "day"},
            ],
        },
        {
            "name": "Смена 09:00",
            "items": [
                {"mid": "20", "name": "Опрос", "time": "09:00", "period": "day"},
                {"mid": "10", "name": "Опрос", "time": "10:15", "period": "day"},  # same mid reused
            ],
        },
    ]
}


class FakeTelegram:
    def __init__(self):
        self.forwarded: list[int] = []

    async def forward(self, mid: int) -> dict:
        self.forwarded.append(mid)
        if mid == 11:
            return {"message_id": 1, "text": "Не забудьте ключ"}
        return {
            "message_id": 1,
            "poll": {
                "question": f"Вопрос {mid}",
                "options": [{"text": "Да", "voter_count": 0}, {"text": "Нет", "voter_count": 0}],
                "is_anonymous": True,
                "allows_multiple_answers": mid == 20,
            },
        }


@pytest.fixture
async def clean(pool):
    await pool.execute("TRUNCATE schedule_items, schedules, templates RESTART IDENTITY CASCADE")
    return pool


async def test_creates_non_anonymous_templates_and_schedules(clean):
    await migrate(clean, FakeTelegram(), SHIFTS)
    rows = await clean.fetch(
        "SELECT legacy_mid, kind::text, text, options, anonymous, multiple FROM templates ORDER BY legacy_mid"
    )
    assert [tuple(r) for r in rows] == [
        ("10", "poll", "Вопрос 10", ["Да", "Нет"], False, False),
        ("11", "text", "Не забудьте ключ", [], False, False),
        ("20", "poll", "Вопрос 20", ["Да", "Нет"], False, True),
    ]
    items = await clean.fetch(
        "SELECT s.name, i.time, t.legacy_mid, i.period FROM schedule_items i "
        "JOIN schedules s ON s.id = i.schedule_id JOIN templates t ON t.id = i.template_id ORDER BY s.name, i.time"
    )
    assert [tuple(r) for r in items] == [
        ("Смена 08:00", "08:00", "10", "day"),
        ("Смена 08:00", "09:15", "11", "day"),
        ("Смена 09:00", "09:00", "20", "day"),
        ("Смена 09:00", "10:15", "10", "day"),
    ]


async def test_rerun_creates_no_duplicates_and_does_not_reforward(clean):
    await migrate(clean, FakeTelegram(), SHIFTS)
    tg = FakeTelegram()
    await migrate(clean, tg, SHIFTS)
    assert tg.forwarded == []
    assert await clean.fetchval("SELECT count(*) FROM templates") == 3
    assert await clean.fetchval("SELECT count(*) FROM schedule_items") == 4
    assert await clean.fetchval("SELECT count(*) FROM schedules") == 2


async def test_each_mid_is_forwarded_once(clean):
    tg = FakeTelegram()
    await migrate(clean, tg, SHIFTS)
    assert sorted(tg.forwarded) == [10, 11, 20]


async def test_dry_run_reads_but_writes_nothing(clean):
    report = await migrate(clean, FakeTelegram(), SHIFTS, dry_run=True)
    assert await clean.fetchval("SELECT count(*) FROM templates") == 0
    assert await clean.fetchval("SELECT count(*) FROM schedules") == 0
    assert len(report) == 3


async def test_forward_failure_aborts_without_partial_writes(clean):
    class Broken(FakeTelegram):
        async def forward(self, mid):
            if mid == 20:
                raise RuntimeError("message to forward not found")
            return await super().forward(mid)

    with pytest.raises(RuntimeError, match="20"):
        await migrate(clean, Broken(), SHIFTS)
    assert await clean.fetchval("SELECT count(*) FROM templates") == 0
