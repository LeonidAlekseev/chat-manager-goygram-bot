"""Bot settings kept by the panel in the one-row `settings` table; secrets are encrypted."""

import asyncio
import base64
import hashlib
import logging
import os
from typing import Any, NamedTuple

import asyncpg
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

log = logging.getLogger(__name__)


# Format shared with the panel (web/src/lib/crypto.ts): base64(iv[12] | ciphertext | tag[16]),
# AES-256-GCM, key = SHA-256(AUTH_SECRET).
def _aes(secret: str) -> AESGCM:
    return AESGCM(hashlib.sha256(secret.encode()).digest())


def encrypt(plain: str, secret: str) -> str:
    iv = os.urandom(12)
    return base64.b64encode(iv + _aes(secret).encrypt(iv, plain.encode(), None)).decode()


def decrypt(token: str, secret: str) -> str:
    raw = base64.b64decode(token)
    return _aes(secret).decrypt(raw[:12], raw[12:], None).decode()


class Settings(NamedTuple):
    bot_token: str | None
    api_id: int | None
    api_hash: str | None


def _open(cipher: str | None, secret: str) -> str | None:
    if not cipher:
        return None
    try:
        return decrypt(cipher, secret)
    except (InvalidTag, ValueError):  # wrong key, or not base64 / too short
        log.error("cannot decrypt a stored secret (AUTH_SECRET changed?); re-enter it in the panel")
        return None


async def load_settings(db: asyncpg.Pool, secret: str) -> Settings:
    row = await db.fetchrow("SELECT bot_token, api_id, api_hash FROM settings WHERE id = 1")
    if not row:
        return Settings(None, None, None)
    return Settings(_open(row["bot_token"], secret), row["api_id"], _open(row["api_hash"], secret))


async def wait_for_token(db: asyncpg.Pool, secret: str, interval: float = 5) -> Settings:
    """Polls until the panel has a bot token; the bot has nothing to do before that."""
    logged = False
    while not (s := await load_settings(db, secret)).bot_token:
        if not logged:
            log.info("no bot token yet: set it in the panel (Настройки)")
            logged = True
        await asyncio.sleep(interval)
    return s


async def watch_settings(db: asyncpg.Pool, secret: str, current: Settings, interval: float = 5) -> None:
    """Returns once the stored settings differ from `current`; the caller exits and compose restarts it."""
    while await load_settings(db, secret) == current:
        await asyncio.sleep(interval)


async def store_bot_username(db: asyncpg.Pool, tg: Any) -> None:
    """Saves the bot's @username for the panel (links to the bot); not part of Settings, so no restart."""
    me = await tg.bot_req("getMe")
    await db.execute("UPDATE settings SET bot_username = $1 WHERE id = 1", me["username"])
