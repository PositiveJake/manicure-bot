import asyncio
import logging
import os
import sqlite3
import tempfile
from datetime import timedelta

from aiogram import Bot
from aiogram.types import FSInputFile

from config import BACKUP_HOUR, OWNER_IDS, local_now

log = logging.getLogger(__name__)


async def send_backup(bot: Bot, db, chat_ids=None):
    """Копирует базу через SQLite Backup API (безопасно при работающем боте)
    и отправляет файлом в чат."""
    chat_ids = list(chat_ids or OWNER_IDS)
    if not chat_ids:
        return
    tmp_dir = tempfile.mkdtemp(prefix="manicure_backup_")
    path = os.path.join(tmp_dir, f"bookings_{local_now():%Y-%m-%d}.db")
    try:
        dest = sqlite3.connect(path)
        try:
            await db.backup(dest)
        finally:
            dest.close()
        for chat_id in chat_ids:
            try:
                await bot.send_document(chat_id, FSInputFile(path))
            except Exception as e:
                log.warning("Бэкап в чат %s не доставлен: %s", chat_id, e)
    finally:
        try:
            os.remove(path)
            os.rmdir(tmp_dir)
        except OSError:
            pass


async def backup_loop(bot: Bot, db):
    """Раз в сутки в BACKUP_HOUR отправляет владельцу файл базы."""
    while True:
        now = local_now()
        target = now.replace(hour=BACKUP_HOUR, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        await asyncio.sleep((target - now).total_seconds())
        try:
            await send_backup(bot, db)
        except Exception:
            log.exception("Ошибка авто-бэкапа")
