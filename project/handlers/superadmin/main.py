from aiogram import Router, filters, F, types
from aiogram.fsm.context import FSMContext

from utils import functions
from handlers import cfilters
from keyboards import SUPERADMIN, CANCEL
from handlers.superadmin.modules import add_admin, edit_admin


router = Router()
router.message.filter(
    cfilters.AdminTypeFilter(_types=['superadmin']),
    cfilters.ChatTypeFilter(_types=['private']),
)


@router.message(filters.Command("superadmin"))
async def cmd_admin(message: types.Message):
    await message.answer('<b>Панель супер админа</b>', reply_markup=SUPERADMIN)


@router.callback_query(F.data == "cmd_add_admin")
async def cmd_add_admin(callback: types.CallbackQuery, state: FSMContext):
    await add_admin.form_start(callback.message, state)
    functions.delete_message(callback.message)
    await callback.answer()


@router.callback_query(F.data == "cmd_edit_admin")
async def cmd_edit_admin(callback: types.CallbackQuery, state: FSMContext):
    await edit_admin.form_start(callback.message, state)
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
