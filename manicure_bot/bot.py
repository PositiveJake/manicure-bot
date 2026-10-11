import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ParseMode
from aiogram.types import CallbackQuery, TelegramObject

import admin_handlers  # noqa: F401
import client_handlers  # noqa: F401
from admin_handlers import router as admin_router
from backup import backup_loop
from client_handlers import router as client_router
from config import BOT_TOKEN, OWNER_IDS, PROXY_URL
from database import init_db
from helpers import notify_owners
from middleware import BlockedMiddleware
from reminders import reminder_loop

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bot")

dp = Dispatcher()
dp.include_routers(client_router, admin_router)
dp.message.middleware(BlockedMiddleware())
dp.callback_query.middleware(BlockedMiddleware())


@dp.errors()
async def on_error(event: TelegramObject, exception: Exception):
    log.exception("Ошибка обработки обновления: %s", exception)
    if isinstance(event, CallbackQuery):
        try:
            await event.answer("⚠️ Произошла ошибка, попробуйте ещё раз.", show_alert=True)
        except Exception:
            pass
    return True


async def main():
    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
        session=AiohttpSession(proxy=PROXY_URL),
    )
    db = await init_db()

    try:
        await bot.delete_webhook(drop_pending_updates=True)
    except Exception as e:
        log.warning("Не удалось сбросить webhook: %s", e)

    await notify_owners(bot, "🤖 Бот записи на маникюр запущен")
    reminder_task = asyncio.create_task(reminder_loop(bot, db))
    backup_task = asyncio.create_task(backup_loop(bot, db))
    try:
        await dp.start_polling(bot, db=db)
    finally:
        reminder_task.cancel()
        backup_task.cancel()
        await db.close()


if __name__ == "__main__":
    if not BOT_TOKEN:
        raise SystemExit("Задайте BOT_TOKEN в файле .env")
    if not OWNER_IDS:
        raise SystemExit("Задайте OWNER_ID в файле .env (ваш Telegram ID)")
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("Бот остановлен.")
