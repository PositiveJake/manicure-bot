import html
import logging

from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery

from config import OWNER_IDS

log = logging.getLogger(__name__)


def esc(v) -> str:
    return html.escape(str(v or ""), quote=False)


async def safe_edit(call: CallbackQuery, text: str, kb=None):
    try:
        await call.edit_text(text, reply_markup=kb)
    except TelegramBadRequest as e:
        if "message is not modified" in str(e).lower():
            return
        if "there is no text in the message to edit" in str(e).lower():
            await call.message.answer(text, reply_markup=kb)
            return
        raise


async def cb_answer(call: CallbackQuery, text: str = "", show_alert: bool = False):
    try:
        await call.answer(text, show_alert=show_alert)
    except Exception:
        pass


async def notify_owners(bot, text: str):
    for owner_id in OWNER_IDS:
        try:
            await bot.send_message(owner_id, text)
        except Exception as e:
            log.warning("Уведомление владельцу %s не доставлено: %s", owner_id, e)
