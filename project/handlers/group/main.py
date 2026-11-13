from aiogram import Router, filters, F, types

from utils import functions
from handlers import cfilters


router = Router()
router.message.filter(
    cfilters.ChatTypeFilter(_types=['group', 'supergroup', 'channel']),
)


@router.message(filters.Command("chatid"))
async def cmd_chatid(message: types.Message):
    await message.answer('<b>Chat ID:</b>')
    await message.answer(str(message.chat.id))

            
@router.message(cfilters.AdminTypeFilter(_types=['chatadmin']), F.text.contains("/all"))
async def cmd_all(message: types.Message):
    try:
        members = await functions.get_chat_members(message.chat.id)
    except BaseException as e:
        await functions.logging_exeption(message, e)
    uids = [m.user.id for m in members]
    try:
        text = message.reply_to_message.text
    except AttributeError:
        text = message.text.replace('/all', '').replace('@ozon_nbot', '').strip()
    if len(text) == 0:
        text = 'Сообщение для всех'
    for uid in uids:
        text += f'<a href="tg://user?id={uid}">&#8205;</a>'
    await message.answer(text)
    