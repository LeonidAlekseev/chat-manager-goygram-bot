from aiogram import Router, filters, F, types

from utils import functions
from handlers import cfilters


router = Router()
router.message.filter(
    cfilters.ChatTypeFilter(_types=['private']),
)


@router.message(filters.Command("start"))
async def cmd_start(message: types.Message):
    text = "\n".join([
        '<b>Команды бота:</b>',
        "/all – Позвать всех [GROUP]",
        "/chatid – Узнать чат ID [GROUP]",
        "/myid – Узнать свой ID [PRIVATE]",
        "/admin – Панель админа [PRIVATE]",
        "/superadmin –Панель супер-админа [PRIVATE]",
        "/start – Запуск бота [PRIVATE]",
    ])
    await message.answer(text)


@router.message(filters.Command("myid"))
async def cmd_myuid(message: types.Message):
    forward_chat = message.forward_from_chat
    await message.answer('<b>User ID:</b>')
    await message.answer(str(message.from_user.id))


@router.message(cfilters.ForwardFilter())
async def cmd_ffuid(message: types.Message):
    await message.answer('<b>User ID:</b>')
    await message.answer(str(message.forward_from.id))
