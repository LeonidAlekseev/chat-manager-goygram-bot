from datetime import date, datetime

import pytest

from bot.scheduler import is_due

START = date(2026, 1, 31)  # a Saturday, and the 31st to exercise short months


def at(y: int, m: int, d: int, hh: int, mm: int) -> datetime:
    return datetime(y, m, d, hh, mm)


@pytest.mark.parametrize(
    ("period", "now", "due"),
    [
        ("day", at(2026, 1, 31, 8, 0), True),
        ("day", at(2026, 3, 5, 8, 0), True),
        ("day", at(2026, 1, 31, 8, 1), False),  # wrong minute
        ("day", at(2026, 1, 30, 8, 0), False),  # before the start date
        ("none", at(2026, 1, 31, 8, 0), True),
        ("none", at(2026, 2, 1, 8, 0), False),
        ("week", at(2026, 2, 7, 8, 0), True),
        ("week", at(2026, 2, 6, 8, 0), False),
        ("twoweek", at(2026, 2, 7, 8, 0), False),
        ("twoweek", at(2026, 2, 14, 8, 0), True),
        ("month", at(2026, 3, 31, 8, 0), True),
        ("month", at(2026, 2, 28, 8, 0), True),  # no Feb 31: last day of the month
        ("month", at(2026, 4, 30, 8, 0), True),
        ("month", at(2026, 4, 29, 8, 0), False),
        ("month", at(2026, 3, 30, 8, 0), False),
        ("yearly", at(2026, 1, 31, 8, 0), False),  # unknown period never fires
    ],
)
def test_is_due(period, now, due):
    assert is_due("08:00", START, period, now) is due


def test_midnight_item_fires_on_the_new_day_only():
    start = date(2026, 1, 1)
    assert is_due("00:00", start, "none", at(2026, 1, 1, 0, 0))
    assert not is_due("00:00", start, "none", at(2026, 1, 2, 0, 0))
    assert not is_due("23:59", start, "none", at(2026, 1, 2, 0, 0))
    assert is_due("23:59", start, "week", at(2026, 1, 8, 23, 59))


def test_month_on_the_15th_keeps_its_day():
    assert is_due("08:00", date(2026, 1, 15), "month", at(2026, 2, 15, 8, 0))
    assert not is_due("08:00", date(2026, 1, 15), "month", at(2026, 2, 28, 8, 0))
