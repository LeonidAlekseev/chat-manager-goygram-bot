"""5-field cron (minute hour day month weekday), the same rules as web/src/lib/cron.ts.

Fields take `*`, `n`, `a-b`, lists and `/step`; no names (JAN, MON) or @macros. Weekday 0 and 7 are Sunday.
As in Vixie cron, when both day fields are restricted (do not start with `*`) either one matching is enough.
"""

import re
from datetime import datetime

RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
ITEM = re.compile(r"(?:\*|(\d+)(?:-(\d+))?)(?:/(\d+))?", re.ASCII)


def parse_cron(expr: str) -> tuple[list[set[int]], bool] | None:
    """The allowed values of each field and whether both day fields are restricted; None if invalid."""
    parts = expr.split()
    if len(parts) != 5:
        return None
    fields = []
    for part, (lo, hi) in zip(parts, RANGES, strict=True):
        values: set[int] = set()
        for item in part.split(","):
            m = ITEM.fullmatch(item)
            if not m:
                return None
            a = int(m[1]) if m[1] else lo
            b = int(m[2]) if m[2] else hi if m[1] is None or m[3] else a  # `5/10` runs 5 to the end
            step = int(m[3] or 1)
            if not lo <= a <= b <= hi or step < 1:
                return None
            values.update(range(a, b + 1, step))
        fields.append(values)
    if 7 in fields[4]:
        fields[4].add(0)
    return fields, not parts[2].startswith("*") and not parts[4].startswith("*")


def cron_matches(expr: str, now: datetime) -> bool:
    """Raises ValueError for an invalid cron: the panel never saves one, so it is reported, not ignored."""
    parsed = parse_cron(expr)
    if parsed is None:
        raise ValueError("invalid cron")
    (minute, hour, day, month, weekday), either = parsed
    days = now.day in day, now.isoweekday() % 7 in weekday
    return now.minute in minute and now.hour in hour and now.month in month and (any(days) if either else all(days))
