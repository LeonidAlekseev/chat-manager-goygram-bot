from aiogram import Router, filters, F, types
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext

from handlers import cfilters
from keyboards import CANCEL, UPDATE
from database.json_data import add_notification
from utils import functions
import keyboards


class AddNotification(StatesGroup):
    set_mid = State()
    set_name = State()
    set_ucid = State()
    set_datetime = State()
    set_period = State()
    finish = State()


router = Router()
router.message.filter(
    cfilters.AdminTypeFilter(_types=['admin']),
    cfilters.ChatTypeFilter(_types=['private']),
    filters.StateFilter(AddNotification),
)


def check_datetime(text):
    try:
        date, time = text.split(' ')
        day, month, year = tuple(map(int, date.split('.')))
        hour, minute = time.split(':')
        assert len(minute) == 2
        hour, minute = tuple(map(int, [hour, minute]))
        assert 1 <= day <= 31
        assert 1 <= month <= 12
        assert 2023 <= year <= 2033
        assert 0 <= hour <= 23
        assert 0 <= minute <= 59
        is_valid = True
    except BaseException:
        is_valid = False
    return is_valid


async def form_start(message: types.Message, state: FSMContext):
    data = await state.get_data()
    data['messages'] = {}
    msg = await message.answer('<b>Введите Message:</b>', reply_markup=CANCEL)
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(AddNotification.set_mid)


@router.message(AddNotification.set_mid)
async def form_set_mid(message: types.Message, state: FSMContext):
    await state.update_data(mid=message.message_id)

    data = await state.get_data()
    msg = await message.answer('<b>Введите Name:</b>')
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(AddNotification.set_name)


@router.message(AddNotification.set_name)
async def form_set_name(message: types.Message, state: FSMContext):
    await state.update_data(name=message.text)

    data = await state.get_data()
    msg = await message.answer('<b>Введите Chat ID:</b>')
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(AddNotification.set_ucid)


@router.message(AddNotification.set_ucid)
async def form_set_ucmid(message: types.Message, state: FSMContext):
    try:
        cid = set(filter(bool, map(str.strip, message.text.split(','))))
        await state.update_data(uid=message.chat.id, cid=cid)

        data = await state.get_data()
        msg = await message.answer('<b>Введите дату и время:</b>\n(в формате 31.12.2023 23:59)')
        data['messages'][msg.message_id] = msg
        await state.update_data(**data)

        await state.set_state(AddNotification.set_datetime)

    except:
        await message.answer('<b>Ошибка, попробуйте еще раз:</b>')


@router.message(AddNotification.set_datetime)
async def form_set_datetime(message: types.Message, state: FSMContext):
    is_valid = check_datetime(message.text)
    if is_valid:
        await state.update_data(datetime=message.text)

        data = await state.get_data()
        keyboard = keyboards.build_inline(
            [
                [
                    {
                        "text": "Без повтора",
                        "callback_data": "form_period_none",
                    },
                ],
                [
                    {
                        "text": "Каждый день",
                        "callback_data": "form_period_day",
                    },
                ],
                [
                    {
                        "text": "Каждую неделю",
                        "callback_data": "form_period_week",
                    },
                ],
                [
                    {
                        "text": "Каждые две недели",
                        "callback_data": "form_period_twoweek",
                    },
                ],
                [
                    {
                        "text": "Каждый месяц",
                        "callback_data": "form_period_month",
                    },
                ],
            ]
        )
        msg = await message.answer('<b>Выберите периодичность:</b>', reply_markup=keyboard)
        data['messages'][msg.message_id] = msg
        await state.update_data(**data)

        await state.set_state(AddNotification.set_period)
    
    else:
        await message.answer('<b>Ошибка, попробуйте еще раз:</b>')


@router.callback_query(AddNotification.set_period, F.data.startswith('form_period_'))
async def form_set_admins(callback: types.CallbackQuery, state: FSMContext):
    await state.update_data(period=callback.data.replace('form_period_', ''))

    data = await state.get_data()
    cid = ", ".join(data["cid"])
    text = f'<b>Добавляемое уведомление:</b>\nUser ID: {data["uid"]}\nChat ID: {cid}\nName: {data["name"]}\nDatetime: {data["datetime"]}\nPeriod: {data["period"]}'
    await callback.message.answer(text)
    msg = await callback.message.answer('<b>Выберите действие</b>', reply_markup=UPDATE)
    data['messages'][msg.message_id] = msg
    await state.update_data(**data)

    await state.set_state(AddNotification.finish)


@router.callback_query(AddNotification.finish, F.data == 'form_save')
async def form_save(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()

    sysmessages = data.get("sysmessages", {})
    for msg in sysmessages.values():
        functions.delete_message(msg)
    messages = data.get("messages", {})
    for msg in messages.values():
        functions.delete_message(msg)
    try:
        add_notification(
            uid=data['uid'], cid=data['cid'], mid=data['mid'], 
            name=data['name'], datetime=data['datetime'], period=data['period'],
        )
    except BaseException as e:
        await functions.logging_exeption(callback.message.from_user.id, e)
    await callback.message.answer('<b>Сохранено</b>')

    await state.clear()
    await callback.answer()

