from aiogram import Router
from . import add_notification, edit_notification


router = Router()
router.include_router(add_notification.router)
router.include_router(edit_notification.router)