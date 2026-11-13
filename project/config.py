from typing import Optional
from pydantic import BaseModel
from aiogram import Dispatcher, Bot

from env import BOT_TOKEN, API_ID, API_HASH, PHONE_NUMBER, SESSION_STRING
from env import TIMEZONE_NAME


class BotConfig(BaseModel):
    bot_token: str
    api_id: int
    api_hash: str
    phone_number: str
    session_string: Optional[str]


class TimezoneConfig(BaseModel):
    name: str


cfg = BotConfig(
    bot_token = BOT_TOKEN,
    api_id = API_ID,
    api_hash = API_HASH,
    phone_number = PHONE_NUMBER,
    session_string = SESSION_STRING,
)
cfg_tz = TimezoneConfig(
    name = TIMEZONE_NAME,
)

dp = Dispatcher()
bot = Bot(cfg.bot_token, parse_mode='html')
