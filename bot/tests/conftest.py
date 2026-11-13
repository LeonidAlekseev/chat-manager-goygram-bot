import os
from pathlib import Path

import asyncpg
import pytest

MIGRATIONS = Path(__file__).resolve().parents[2] / "web" / "prisma" / "migrations"


@pytest.fixture(scope="session")
async def pool():
    # Fresh schema from the panel's Prisma migrations: the bot never owns the schema.
    url = os.environ["TEST_DATABASE_URL"]
    conn = await asyncpg.connect(url)
    await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    for sql in sorted(MIGRATIONS.glob("*/migration.sql")):
        await conn.execute(sql.read_text())
    await conn.close()
    p = await asyncpg.create_pool(url)
    yield p
    await p.close()


@pytest.fixture
async def db(pool):
    await pool.execute("TRUNCATE chats")
    return pool
