from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message

from config import is_owner
from database import get_user


class BlockedMiddleware(BaseMiddleware):
    """Не пускает заблокированных пользователей к обработчикам."""

    async def __call__(self, handler, event, data):
        if isinstance(event, (Message, CallbackQuery)):
            user = data.get("event_from_user")
            message = event if isinstance(event, Message) else event.message
            if user and message and not is_owner(user.id):
                row = await get_user(data["db"], user.id)
                if row and row["is_blocked"]:
                    if isinstance(event, CallbackQuery):
                        try:
                            await event.answer("Вы заблокированы в этом боте.", show_alert=True)
                        except Exception:
                            pass
                    else:
                        await message.answer("Вы заблокированы в этом боте.")
                    return None
        return await handler(event, data)
