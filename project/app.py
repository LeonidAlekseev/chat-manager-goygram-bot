import logging
import asyncio
from aiogram import Bot, types

from config import dp, bot
from services import APScheduler 
from handlers import group, user, admin, superadmin


async def set_commands(bot: Bot):
    commands = [
        types.BotCommand(command="/all", description="Позвать всех [GROUP]"),
        types.BotCommand(command="/chatid", description="Узнать чат ID [GROUP]"),
        types.BotCommand(command="/myid", description="Узнать свой ID [PRIVATE]"),
        types.BotCommand(command="/admin", description="Панель админа [PRIVATE]"),
        types.BotCommand(command="/superadmin", description="Панель суперадмина [PRIVATE]"),
        types.BotCommand(command="/start", description="Запуск бота [PRIVATE]"),
    ]
    await bot.set_my_commands(commands)


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(name)s - %(message)s")

    APScheduler.setup()
    
    dp.include_router(group.router)
    dp.include_router(user.router)
    dp.include_router(admin.router)
    dp.include_router(superadmin.router)

    await set_commands(bot)
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
