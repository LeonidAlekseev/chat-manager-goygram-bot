from aiogram import Router
from . import add_admin, edit_admin


router = Router()
router.include_router(add_admin.router)
router.include_router(edit_admin.router)