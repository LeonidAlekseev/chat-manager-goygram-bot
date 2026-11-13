"""One-off: copy the old bot's poll/text messages into templates and seed the two shifts.

Run once under the OLD bot token (see README). Idempotent: templates are keyed by legacy_mid.
"""

import argparse
import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Protocol

import asyncpg

SHIFTS_FILE = Path(__file__).with_name("legacy_shifts.json")


class Telegram(Protocol):
    async def forward(self, mid: int) -> dict[str, Any]: ...


class BotApi:
    """Forwards old messages from the admin's private chat into a service chat to read them."""

    def __init__(self, token: str, from_chat: int, to_chat: int) -> None:
        self.token, self.from_chat, self.to_chat = token, from_chat, to_chat

    async def forward(self, mid: int) -> dict[str, Any]:
        data = urllib.parse.urlencode(
            {"chat_id": self.to_chat, "from_chat_id": self.from_chat, "message_id": mid}
        ).encode()

        def call() -> dict[str, Any]:
            try:
                with urllib.request.urlopen(
                    f"https://api.telegram.org/bot{self.token}/forwardMessage", data
                ) as r:
                    return json.load(r)  # type: ignore[no-any-return]
            except urllib.error.HTTPError as e:
                return json.load(e)  # type: ignore[no-any-return]

        res = await asyncio.to_thread(call)
        if not res.get("ok"):
            raise RuntimeError(res.get("description", "forwardMessage failed"))
        return res["result"]  # type: ignore[no-any-return]


def to_template(msg: dict[str, Any], fallback_name: str) -> dict[str, Any]:
    poll = msg.get("poll")
    if poll:
        # Non-anonymous on purpose: poll_answer updates only arrive for non-anonymous polls.
        return {
            "kind": "poll",
            "text": poll["question"],
            "options": [o["text"] for o in poll["options"]],
            "multiple": bool(poll.get("allows_multiple_answers")),
        }
    return {
        "kind": "text",
        "text": msg.get("text") or msg.get("caption") or fallback_name,
        "options": [],
        "multiple": False,
    }


async def migrate(db: asyncpg.Pool, tg: Telegram, shifts: dict[str, Any], dry_run: bool = False) -> list[str]:
    """Returns a human-readable report of the templates that were (or would be) created."""
    names: dict[str, str] = {}
    for shift in shifts["shifts"]:
        for item in shift["items"]:
            names.setdefault(item["mid"], item["name"])
    existing = {r["legacy_mid"] for r in await db.fetch("SELECT legacy_mid FROM templates")}

    # Read everything first so a failed forward leaves the DB untouched.
    fresh: dict[str, dict[str, Any]] = {}
    for mid, name in names.items():
        if mid in existing:
            continue
        try:
            fresh[mid] = to_template(await tg.forward(int(mid)), name)
        except Exception as e:
            raise RuntimeError(f"mid {mid}: {e}") from e
    report = [f"{m}: {t['kind']} «{t['text'][:60]}»" for m, t in fresh.items()]
    if dry_run:
        return report

    async with db.acquire() as conn, conn.transaction():
        for mid, t in fresh.items():
            await conn.execute(
                "INSERT INTO templates (name, kind, text, options, multiple, anonymous, legacy_mid) "
                'VALUES ($1, $2::"TemplateKind", $3, $4, $5, false, $6) ON CONFLICT (legacy_mid) DO NOTHING',
                names[mid],
                t["kind"],
                t["text"],
                t["options"],
                t["multiple"],
                mid,
            )
        for shift in shifts["shifts"]:
            sid = await conn.fetchval(
                "INSERT INTO schedules (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
                shift["name"],
            )
            for item in shift["items"]:
                await conn.execute(
                    "INSERT INTO schedule_items (schedule_id, template_id, time, period) "
                    "SELECT $1, id, $3, $4 FROM templates WHERE legacy_mid = $2 "
                    "ON CONFLICT (schedule_id, template_id, time) DO NOTHING",
                    sid,
                    item["mid"],
                    item["time"],
                    item["period"],
                )
    return report


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="read the old messages, write nothing to the DB")
    args = ap.parse_args()
    tg = BotApi(
        os.environ["OLD_BOT_TOKEN"], int(os.environ["OLD_ADMIN_CHAT_ID"]), int(os.environ["SERVICE_CHAT_ID"])
    )
    db = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    try:
        for line in await migrate(db, tg, json.loads(SHIFTS_FILE.read_text()), args.dry_run):
            print(line)
    finally:
        await db.close()
    print("dry run: nothing written" if args.dry_run else "done")


if __name__ == "__main__":
    asyncio.run(main())
