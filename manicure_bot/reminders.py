import asyncio
import logging
from datetime import date, datetime, time, timedelta

import aiosqlite
from aiogram import Bot

from config import OWNER_IDS, REMINDER_TIME, local_now
from database import get_unsent_reminders, mark_reminder_sent
from keyboards import fmt_dmy_wd

log = logging.getLogger(__name__)


def when_word(appt_date: date, now: date) -> str:
    if appt_date == now:
        return "сегодня"
    if appt_date == now + timedelta(days=1):
        return "завтра"
    return fmt_dmy_wd(appt_date)


def reminder_due(appt_date: date, now: datetime) -> bool:
    """Напоминание «за день до»: в REMINDER_TIME накануне, либо сразу,
    если запись сделана позже этого времени накануне (или в тот же день)."""
    due = datetime.combine(appt_date - timedelta(days=1), REMINDER_TIME)
    return due <= now


def client_text(appt_date: date, appt_time: str, now: datetime) -> str:
    return (
        "⏰ <b>Напоминание о записи</b>\n\n"
        f"Ваш маникюр — <b>{when_word(appt_date, now.date())}</b> в <b>{appt_time}</b>. Ждём вас! 💅\n\n"
        "Если планы изменились, отмените запись в разделе «📋 Мои записи»."
    )


def owner_line(row) -> str:
    name = row["user_name"] or "клиент"
    phone = row["user_phone"] or "нет телефона"
    username = f", @{row['user_username']}" if row["user_username"] else ""
    return f"• {row['time']} — {name} ({phone}{username})"


async def send_due_reminders(bot: Bot, db: aiosqlite.Connection, now: datetime | None = None):
    """Разбирает очередь напоминаний. Вызывается раз в минуту; устойчиво к простоям бота."""
    now = now or local_now()
    day_from = (now.date() - timedelta(days=1)).isoformat()
    day_to = (now.date() + timedelta(days=2)).isoformat()
    rows = await get_unsent_reminders(db, day_from, day_to)
    if not rows:
        return

    to_notify: dict[str, list] = {}  # дата -> строки для владельца
    for r in rows:
        appt_date = date.fromisoformat(r["date"])
        if appt_date < now.date():
            # сеанс уже прошёл — просто закрываем напоминание, чтобы не копилось
            await mark_reminder_sent(db, r["id"])
            continue
        if not reminder_due(appt_date, now):
            continue
        try:
            await bot.send_message(r["tg_user_id"], client_text(appt_date, r["time"], now))
        except Exception as e:
            log.warning("Напоминание клиенту %s не доставлено: %s", r["tg_user_id"], e)
        to_notify.setdefault(r["date"], []).append(owner_line(r))
        await mark_reminder_sent(db, r["id"])

    for appt_day, lines in sorted(to_notify.items()):
        header = when_word(date.fromisoformat(appt_day), now.date())
        text = f"⏰ <b>Напоминания отправлены ({header}):</b>\n" + "\n".join(lines)
        for owner_id in OWNER_IDS:
            try:
                await bot.send_message(owner_id, text)
            except Exception as e:
                log.warning("Дайджест владельцу %s не доставлен: %s", owner_id, e)


async def reminder_loop(bot: Bot, db: aiosqlite.Connection):
    while True:
        try:
            await send_due_reminders(bot, db)
        except Exception:
            log.exception("Ошибка цикла напоминаний")
        await asyncio.sleep(60)
