import os
from datetime import date, datetime, time, timedelta, timezone

from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = (os.getenv("BOT_TOKEN") or "").strip()

# Владелец: OWNER_ID (один) плюс список через запятую в OWNER_IDS (по желанию)
OWNER_ID = int(os.getenv("OWNER_ID", "0") or 0)
OWNER_IDS = {OWNER_ID} if OWNER_ID else set()
for _part in (os.getenv("OWNER_IDS") or "").replace(";", ",").split(","):
    _part = _part.strip()
    if _part.isdigit():
        OWNER_IDS.add(int(_part))


def is_owner(tg_id: int) -> bool:
    return tg_id in OWNER_IDS


# Прокси для доступа к Telegram API, например http://127.0.0.1:1080 (необязательно)
PROXY_URL = (os.getenv("PROXY_URL") or "").strip() or None

# Ссылка на канал (необязательно): добавит кнопку «📣 Наш канал» в меню
CHANNEL_URL = (os.getenv("CHANNEL_URL") or "").strip() or None


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


# График работы и длина сеанса (в минутах). Слоты строятся от начала до конца дня.
WORK_START = _int_env("WORK_START", 10)   # 10:00
WORK_END = _int_env("WORK_END", 20)       # 20:00 (последний слот должен заканчиваться к этому времени)
SLOT_MINUTES = _int_env("SLOT_MINUTES", 45)

# На сколько месяцев вперёд клиент видит календарь
BOOKING_MONTHS_AHEAD = _int_env("BOOKING_MONTHS_AHEAD", 2)

# Насколько глубоко в прошлое владелец может листать календарь записей
ADMIN_MONTHS_BACK = _int_env("ADMIN_MONTHS_BACK", 2)

# Напоминание приходит за 1 день до сеанса в это время (или сразу после,
# если запись сделана позже этого времени накануне)
REMINDER_TIME = time(_int_env("REMINDER_HOUR", 12), _int_env("REMINDER_MINUTE", 0))

# Час суточного авто-бэкапа базы в чат владельцу
BACKUP_HOUR = _int_env("BACKUP_HOUR", 3)

# Часовой пояс салона. На серверах время обычно UTC, поэтому там обязательно
# задать TZ_NAME=Europe/Moscow (или TZ_OFFSET_HOURS=3), иначе график и
# напоминания сдвинутся. Локально на компьютере можно не задавать.
TZ_NAME = (os.getenv("TZ_NAME") or "").strip() or None
TZ_OFFSET_HOURS = (os.getenv("TZ_OFFSET_HOURS") or "").strip() or None


def local_now() -> datetime:
    """Местное время салона (наивный datetime, часовой пояс уже учтён)."""
    if TZ_NAME:
        try:
            from zoneinfo import ZoneInfo
            return datetime.now(ZoneInfo(TZ_NAME)).replace(tzinfo=None)
        except Exception:
            pass
    if TZ_OFFSET_HOURS:
        try:
            off = timezone(timedelta(hours=float(TZ_OFFSET_HOURS)))
            return datetime.now(off).replace(tzinfo=None)
        except ValueError:
            pass
    return datetime.now()


def local_today() -> date:
    return local_now().date()


def build_slots() -> list[str]:
    slots: list[str] = []
    t = WORK_START * 60
    end = WORK_END * 60
    while t + SLOT_MINUTES <= end:
        slots.append(f"{t // 60:02d}:{t % 60:02d}")
        t += SLOT_MINUTES
    return slots


TIME_SLOTS = build_slots()
