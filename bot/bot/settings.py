"""Bot settings kept by the panel in the one-row `settings` table; secrets are encrypted."""

import asyncio
import base64
import logging
import os
from typing import Any, NamedTuple

import asyncpg
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

log = logging.getLogger(__name__)


# Format shared with the panel (web/src/lib/crypto.ts): base64(iv[12] | ciphertext | tag[16]),
# AES-256-GCM, key = HKDF-SHA256(AUTH_SECRET, no salt, info "chat-manager settings v1").
def _key(secret: str, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(secret.encode())


def _aes(secret: str) -> AESGCM:
    return AESGCM(_key(secret, b"chat-manager settings v1"))


def vault_key(secret: str) -> str:
    """GOYGRAM_VAULT_KEY for the user client's vault file, so it does not open with the host's machine-id."""
    return base64.b64encode(_key(secret, b"chat-manager goygram vault v1")).decode()


def encrypt(plain: str, secret: str) -> str:
    iv = os.urandom(12)
    return base64.b64encode(iv + _aes(secret).encrypt(iv, plain.encode(), None)).decode()


def decrypt(token: str, secret: str) -> str:
    raw = base64.b64decode(token)
    return _aes(secret).decrypt(raw[:12], raw[12:], None).decode()


UNREADABLE_TOKEN = "Токен бота не расшифровывается (сменился AUTH_SECRET?): введите его заново в Настройках."


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
            # A stored token that does not decrypt; start_bot clears bot_error once a token works.
            await db.execute(
                "UPDATE settings SET bot_error = $1 WHERE id = 1 AND bot_token IS NOT NULL", UNREADABLE_TOKEN)
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
