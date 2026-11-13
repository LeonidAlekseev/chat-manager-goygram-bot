from aiogram import Router, filters, F, types
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext

from handlers import cfilters
from keyboards import CANCEL, UPDATE
from database.json_data import get_notification, del_notification
from utils import functions
import keyboards
from config import bot


class EditNotification(StatesGroup):
    set_messages = State()
    set_ucmids = State()
    finish = State()


router = Router()
router.message.filter(
    cfilters.AdminTypeFilter(_types=['admin']),
    cfilters.ChatTypeFilter(_types=['private']),
    filters.StateFilter(EditNotification),
)


async def form_start(message: types.Message, state: FSMContext):
    await state.update_data(
        uids=[],
        cids=[],
        mids=[],
        names=[],
        messages={},
        sysmessages={},
    )

    data = await state.get_data()
    msg = await message.answer('<b>Список уведомлений:</b>', reply_markup=CANCEL)
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(EditNotification.set_messages)
    await form_set_messages(message, state)


@router.message(EditNotification.set_messages)
async def form_set_messages(message: types.Message, state: FSMContext):
    data = await state.get_data()

    uid = message.chat.id
    umsg = get_notification(uid)
    for cid in umsg.keys():
        for ucmsg in umsg[cid]:
            text = f'User ID: {uid}\nChat ID: {cid}\nMessage ID: {ucmsg["mid"]}\nName: {ucmsg["name"]}\nDatetime: {ucmsg["datetime"]}\nPeriod: {ucmsg["period"]}'
            keyboard = keyboards.build_inline(
                [
                    [
                        {
                            "text": "Удалить",
                            "callback_data": "form_del_notification",
                        },
                    ],
                ]
            )
            msg_copy = await bot.copy_message(from_chat_id=uid, chat_id=uid, message_id=ucmsg["mid"])
            msg = await message.answer(text, reply_markup=keyboard)
            data['messages'][msg.message_id] = [{"chat_id":uid, "message_id":msg_copy.message_id}, msg]
    await state.update_data(**data)

    await state.set_state(EditNotification.set_ucmids)


@router.callback_query(filters.or_f(EditNotification.set_ucmids, EditNotification.finish), F.data == 'form_del_notification')
async def form_set_notifications(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()

    uid = callback.message.chat.id
    cid = callback.message.text.split('\n')[1].split(': ')[-1]
    mid = callback.message.text.split('\n')[2].split(': ')[-1]
    name = callback.message.text.split('\n')[3].split(': ')[-1]
    data["uids"].append(uid)
    data["cids"].append(cid)
    data["mids"].append(mid)
    data["names"].append(name)

    for msg in data["sysmessages"].values():
        functions.delete_message(msg)
    text = "\n".join(['<b>Удаляемые уведомления:</b>'] + data["names"])
    msg = await callback.message.answer(text)
    data["sysmessages"][msg.message_id] = msg
    msg = await callback.message.answer('<b>Выберите действие</b>', reply_markup=UPDATE)
    data["sysmessages"][msg.message_id] = msg

    msg = data["messages"][callback.message.message_id]
    functions.delete_message(msg)
    del msg

    await state.update_data(**data)

    await state.set_state(EditNotification.finish)
    await callback.answer()


@router.callback_query(EditNotification.finish, F.data == 'form_save')
async def form_save(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()

    functions.delete_message(list(data.get("sysmessages", {}).values()))
    functions.delete_message(list(data.get("messages", {}).values()))
    try:
        for uid, cid, mid in zip(data["uids"], data["cids"], data["mids"]):
            del_notification(uid, cid, mid)
    except BaseException as e:
        await functions.logging_exeption(callback.message.from_user.id, e)
    await callback.message.answer('<b>Сохранено</b>')
    
    await state.clear()
    await callback.answer()
