from aiogram import Router
from . import main, modules

router = Router()

router.include_router(main.router)
router.include_router(modules.router)