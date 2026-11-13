from aiogram import Router, filters, F, types
from aiogram.fsm.context import FSMContext

from utils import functions
from handlers import cfilters
from keyboards import ADMIN, CANCEL
from handlers.admin.modules import add_notification, edit_notification


router = Router()
router.message.filter(
    cfilters.AdminTypeFilter(_types=['admin']),
    cfilters.ChatTypeFilter(_types=['private']),
)


@router.message(F.text=="Добавить уведомление")
async def cmd_add_notification(message: types.Message, state: FSMContext):
    await add_notification.form_start(message, state)


@router.message(filters.Command("admin"))
async def cmd_admin(message: types.Message):
    await message.answer('<b>Панель админа</b>', reply_markup=ADMIN)


@router.callback_query(F.data == "cmd_add_notification")
async def cmd_add_notification(callback: types.CallbackQuery, state: FSMContext):
    await add_notification.form_start(callback.message, state)
    functions.delete_message(callback.message)
    await callback.answer()


@router.callback_query(F.data == "cmd_edit_notification")
async def cmd_edit_notification(callback: types.CallbackQuery, state: FSMContext):
    await edit_notification.form_start(callback.message, state)
    functions.delete_message(callback.message)
    await callback.answer()


@router.callback_query(F.data.in_({'cmd_cancel', 'form_cancel'}))
async def form_cancel(callback: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    
    functions.delete_message(list(data.get("sysmessages", {}).values()))
    functions.delete_message(list(data.get("messages", {}).values()))
    await callback.message.delete()
    await callback.message.answer('<b>Отменено</b>')

    await state.clear()
    await callback.answer()
