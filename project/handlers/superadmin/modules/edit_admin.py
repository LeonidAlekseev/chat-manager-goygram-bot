from aiogram import Router, filters, F, types
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext

from handlers import cfilters
from keyboards import CANCEL, UPDATE
from database.json_data import get_admin, del_admin
from utils import functions
import keyboards


class EditAdmin(StatesGroup):
    set_messages = State()
    set_uids = State()
    finish = State()


router = Router()
router.message.filter(
    cfilters.AdminTypeFilter(_types=['superadmin']),
    cfilters.ChatTypeFilter(_types=['private']),
    filters.StateFilter(EditAdmin),
)


async def form_start(message: types.Message, state: FSMContext):
    await state.update_data(
        uids=[],
        names=[],
        messages={},
        sysmessages={},
    )

    data = await state.get_data()
    msg = await message.answer('<b>Список админов:</b>', reply_markup=CANCEL)
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(EditAdmin.set_messages)
    await form_set_messages(message, state)


@router.message(EditAdmin.set_messages)
async def form_set_messages(message: types.Message, state: FSMContext):
    data = await state.get_data()
    
    users = get_admin()
    for usr in users:
        text = f'User ID: {usr["uid"]}\nName: {usr["name"]}'
        keyboard = keyboards.build_inline(
            [
                [
                    {
                        "text": "Удалить",
                        "callback_data": "form_del_admin",
                    },
                ],
            ]
        )
        msg = await message.answer(text, reply_markup=keyboard)
        data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(EditAdmin.set_uids)


@router.callback_query(filters.or_f(EditAdmin.set_uids, EditAdmin.finish), F.data == 'form_del_admin')
async def form_set_admins(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()

    uid = callback.message.text.split('\n')[0].split(': ')[-1]
    name = callback.message.text.split('\n')[1].split(': ')[-1]
    data["uids"].append(uid)
    data["names"].append(name)

    for msg in data["sysmessages"].values():
        functions.delete_message(msg)
    text = "\n".join(['<b>Удаляемые админы:</b>'] + data["names"])
    msg = await callback.message.answer(text)
    data["sysmessages"][msg.message_id] = msg
    msg = await callback.message.answer('<b>Выберите действие</b>', reply_markup=UPDATE)
    data["sysmessages"][msg.message_id] = msg

    msg = data["messages"][callback.message.message_id]
    functions.delete_message(msg)
    del msg

    await state.update_data(**data)

    await state.set_state(EditAdmin.finish)
    await callback.answer()


@router.callback_query(EditAdmin.finish, F.data == 'form_save')
async def form_save(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    
    functions.delete_message(list(data.get("sysmessages", {}).values()))
    functions.delete_message(list(data.get("messages", {}).values()))
    try:
        for uid in data["uids"]:
            del_admin(uid)
    except BaseException as e:
        await functions.logging_exeption(callback.message.from_user.id, e)
    await callback.message.answer('<b>Сохранено</b>')

    cfilters.AdminTypeFilter.update_data()
    await state.clear()
    await callback.answer()
