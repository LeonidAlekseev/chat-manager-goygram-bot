from typing import Union
from aiogram import Bot, Router, filters, F, types

from utils import functions
from database.json_data import get_admin


class ForwardFilter(filters.BaseFilter):
    async def __call__(self, message: types.Message) -> bool:
        return message.forward_from is not None

        
class ChatTypeFilter(filters.BaseFilter):
    def __init__(self, _types: list):
        self._types = _types

    async def __call__(self, message: types.Message) -> bool:
        return message.chat.type in self._types


class AdminTypeFilter(filters.BaseFilter):
    all_admins: dict = {
        "superadmin": [],
        "admin": [],
    }

    def __init__(self, _types: list):
        self._types = _types
    
    @classmethod
    def update_data(cls):
        for k in cls.all_admins.keys():
            cls.all_admins[k] = [u["uid"] for u in get_admin(_type=k)]

    async def __call__(self, message: types.Message) -> bool:
        check_list = [message.from_user.id in AdminTypeFilter.all_admins[tp] for tp in self._types if tp != 'chatadmin']
        if 'chatadmin' in self._types:
            members = await functions.get_chat_members(message.chat.id, is_admin=True)
            chatadmin = [m.user.id for m in members]
            check_list.append(message.from_user.id in chatadmin)
        return any(check_list)

AdminTypeFilter.update_data()