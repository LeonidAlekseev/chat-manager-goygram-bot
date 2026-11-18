import asyncio
import base64
import json
from pathlib import Path

import pytest
from cryptography.exceptions import InvalidTag
from goygram.security import _vault_env_key

from bot.settings import (
    Settings,
    decrypt,
    encrypt,
    load_settings,
    store_bot_username,
    vault_key,
    wait_for_token,
    watch_settings,
)

VECTOR = json.loads((Path(__file__).resolve().parents[2] / "web" / "tests" / "crypto-vector.json").read_text())


def test_decrypts_the_vector_shared_with_the_panel():
    assert decrypt(VECTOR["ciphertext"], VECTOR["secret"]) == VECTOR["plaintext"]


def test_round_trips_with_a_fresh_iv():
    a = encrypt("hello", "k")
    assert a != encrypt("hello", "k")
    assert decrypt(a, "k") == "hello"


def test_rejects_a_wrong_key():
    with pytest.raises(InvalidTag):
        decrypt(VECTOR["ciphertext"], "other")


SECRET = "bot-test-secret"


@pytest.fixture
async def sdb(pool):
    await pool.execute("TRUNCATE settings")
    return pool


async def put(db, token=None, api_id=None, api_hash=None):
    await db.execute(
        "INSERT INTO settings (id, bot_token, api_id, api_hash) VALUES (1, $1, $2, $3) "
        "ON CONFLICT (id) DO UPDATE SET bot_token = $1, api_id = $2, api_hash = $3",
        token and encrypt(token, SECRET), api_id, api_hash and encrypt(api_hash, SECRET),
    )


async def test_no_row_means_nothing_configured(sdb):
    assert await load_settings(sdb, SECRET) == Settings(None, None, None)


async def test_loads_and_decrypts(sdb):
    await put(sdb, "1:tok", 2040, "hash")
    assert await load_settings(sdb, SECRET) == Settings("1:tok", 2040, "hash")


async def test_undecryptable_secret_counts_as_unset(sdb):
    await put(sdb, "1:tok", 2040, "hash")
    assert await load_settings(sdb, "other-secret") == Settings(None, 2040, None)


async def test_waits_for_a_token_without_crashing(sdb):
    waiting = asyncio.create_task(wait_for_token(sdb, SECRET, interval=0.01))
    await asyncio.sleep(0.05)
    assert not waiting.done()
    await put(sdb, "1:tok")
    assert (await asyncio.wait_for(waiting, 1)).bot_token == "1:tok"


@pytest.mark.parametrize("change", [{"token": "2:new"}, {"api_id": 1}, {"api_hash": "other"}])
async def test_watch_returns_when_a_value_changes(sdb, change):
    await put(sdb, "1:tok", 2040, "hash")
    current = await load_settings(sdb, SECRET)
    watching = asyncio.create_task(watch_settings(sdb, SECRET, current, interval=0.01))
    await put(sdb, "1:tok", 2040, "hash")  # same values, fresh ciphertext: not a change
    await asyncio.sleep(0.05)
    assert not watching.done()
    await put(sdb, **{"token": "1:tok", "api_id": 2040, "api_hash": "hash", **change})
    await asyncio.wait_for(watching, 1)


class FakeMe:
    async def bot_req(self, meth, **kw):
        assert meth == "getMe"
        return {"id": 1, "is_bot": True, "username": "goy_manager_bot"}


async def test_stores_the_bot_username_without_counting_as_a_change(sdb):
    await put(sdb, "1:tok")
    current = await load_settings(sdb, SECRET)
    await store_bot_username(sdb, FakeMe())
    assert await sdb.fetchval("SELECT bot_username FROM settings") == "goy_manager_bot"
    assert await load_settings(sdb, SECRET) == current  # no restart loop


async def test_a_token_encrypted_with_another_secret_is_shown_in_the_panel(sdb):
    await put(sdb, "1:tok")
    waiting = asyncio.create_task(wait_for_token(sdb, "other-secret", interval=0.01))
    await asyncio.sleep(0.05)
    assert not waiting.done()
    assert "AUTH_SECRET" in await sdb.fetchval("SELECT bot_error FROM settings")
    waiting.cancel()


def test_the_vault_key_comes_from_auth_secret_and_goygram_takes_it(monkeypatch):
    key = vault_key(SECRET)
    assert key == vault_key(SECRET) != vault_key("other") and len(base64.b64decode(key)) == 32
    monkeypatch.setenv("GOYGRAM_VAULT_KEY", key)
    assert _vault_env_key() == base64.b64decode(key)
