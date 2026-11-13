from aiogram import Router, filters, F, types
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext

from handlers import cfilters
from keyboards import CANCEL, UPDATE
from database.json_data import add_admin
from utils import functions
import keyboards


class AddAdmin(StatesGroup):
    set_uid = State()
    set_name = State()
    finish = State()


router = Router()
router.message.filter(
    cfilters.AdminTypeFilter(_types=['superadmin']),
    cfilters.ChatTypeFilter(_types=['private']),
    filters.StateFilter(AddAdmin),
)


async def form_start(message: types.Message, state: FSMContext):
    data = await state.get_data()
    data['messages'] = {}
    msg = await message.answer('<b>Введите User ID:</b>', reply_markup=CANCEL)
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(AddAdmin.set_uid)


@router.message(AddAdmin.set_uid)
async def form_set_uid(message: types.Message, state: FSMContext):
    await state.update_data(uid=message.text)

    data = await state.get_data()
    msg = await message.answer('<b>Введите Name:</b>')
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(AddAdmin.set_name)


@router.message(AddAdmin.set_name)
async def form_set_name(message: types.Message, state: FSMContext):
    await state.update_data(name=message.text)

    data = await state.get_data()
    text = f'<b>Добавляемый админ:</b>\nUser ID: {data["uid"]}\nName: {data["name"]}'
    await message.answer(text)
    msg = await message.answer('<b>Выберите действие</b>', reply_markup=UPDATE)
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(AddAdmin.finish)


@router.callback_query(AddAdmin.finish, F.data == 'form_save')
async def form_save(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()

    sysmessages = data.get("sysmessages", {})
    for msg in sysmessages.values():
        functions.delete_message(msg)
    messages = data.get("messages", {})
    for msg in messages.values():
        functions.delete_message(msg)
    try:
        add_admin(
            uid=data['uid'], 
            name=data['name'],
        )
    except BaseException as e:
        await functions.logging_exeption(callback.message.from_user.id, e)
    await callback.message.answer('<b>Сохранено</b>')

    cfilters.AdminTypeFilter.update_data()
    await state.clear()
    await callback.answer()
