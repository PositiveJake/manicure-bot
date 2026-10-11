import calendar as pycal
from datetime import date

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from config import local_today

MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
             "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

# префиксы callback-данных (используются и в обработчиках)
CB_NOOP = "noop"
CB_MAIN = "menu:main"
CB_BOOK = "menu:book"
CB_MINE = "menu:mine"
CB_PHONE = "menu:phone"
CB_PHONE_CANCEL = "phone:cancel"
CB_ADMIN = "menu:admin"
CB_CCAL = "ccal"    # календарь клиента: ccal:YYYYMM
CB_CDAY = "cday"    # слоты клиента: cday:YYYY-MM-DD
CB_CSLOT = "cslot"  # выбор слота: cslot:YYYY-MM-DD|HH:MM
CB_CCF = "ccf"      # подтверждение: ccf:YYYY-MM-DD|HH:MM
CB_CCN = "ccn"      # отказ от подтверждения
CB_CANCELQ = "cancelq"  # вопрос об отмене: cancelq:<id>
CB_CANCEL2 = "cancel2"  # отмена подтверждена: cancel2:<id>
CB_ACAL = "acal"    # календарь владельца: acal:YYYYMM
CB_ADAY = "aday"    # день владельца: aday:YYYY-MM-DD
CB_ABK = "abk"      # карточка записи: abk:<id>
CB_AUPD = "aupd"    # вопрос об отмене владельцем: aupd:<id>
CB_AUP2 = "aup2"    # отмена подтверждена владельцем: aup2:<id>
CB_BLK = "blk"      # блокировка: blk:<uid>:<куда вернуться>
CB_ACL = "acl"      # список клиентов: acl:<page>
CB_ACLU = "aclu"    # карточка клиента: aclu:<uid>
CB_NEAREST = "nearest"
CB_BLOCKED = "blocked"


def fmt_dmy(d: date) -> str:
    return f"{d.day:02d}.{d.month:02d}.{d.year}"


def fmt_dmy_wd(d: date) -> str:
    return f"{fmt_dmy(d)}, {WEEKDAYS_RU[d.weekday()].lower()}"


def main_menu_kb(is_owner: bool) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(text="📅 Записаться", callback_data=CB_BOOK)]]
    if is_owner:
        rows.append([InlineKeyboardButton(text="🛠 Панель владельца", callback_data=CB_ADMIN)])
    second = [InlineKeyboardButton(text="📋 Мои записи", callback_data=CB_MINE),
              InlineKeyboardButton(text="📞 Мой телефон", callback_data=CB_PHONE)]
    rows.append(second)
    return InlineKeyboardMarkup(inline_keyboard=rows)


def phone_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Не указывать", callback_data=CB_PHONE_CANCEL)],
    ])


def calendar_kb(year: int, month: int, min_ym: int, max_ym: int, nav_prefix: str,
                day_cb: dict[date, str | None], day_label: dict[date, str]) -> InlineKeyboardMarkup:
    """Сетка месяца: 1-я строка — навигация, далее дни. day_cb[d] = callback или None (день недоступен)."""
    ym = year * 100 + month
    prev_ym = ym - 1 if month > 1 else (year - 1) * 100 + 12
    next_ym = ym + 1 if month < 12 else (year + 1) * 100 + 1

    rows = [[
        InlineKeyboardButton(text="◀️", callback_data=f"{nav_prefix}:{prev_ym}" if prev_ym >= min_ym else CB_NOOP),
        InlineKeyboardButton(text=f"{MONTHS_RU[month - 1]} {year}", callback_data=CB_NOOP),
        InlineKeyboardButton(text="▶️", callback_data=f"{nav_prefix}:{next_ym}" if next_ym <= max_ym else CB_NOOP),
    ]]
    rows.append([InlineKeyboardButton(text=w, callback_data=CB_NOOP) for w in WEEKDAYS_RU])

    offset = date(year, month, 1).weekday()
    days_in_month = pycal.monthrange(year, month)[1]
    cells: list[InlineKeyboardButton] = [
        InlineKeyboardButton(text=" ", callback_data=CB_NOOP) for _ in range(offset)
    ]
    for day in range(1, days_in_month + 1):
        d = date(year, month, day)
        cb = day_cb.get(d)
        label = day_label.get(d, str(day))
        cells.append(InlineKeyboardButton(text=label, callback_data=cb or CB_NOOP))
    for i in range(0, len(cells), 7):
        rows.append(cells[i:i + 7])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def slots_kb(day: str, slots: list[str]) -> InlineKeyboardMarkup:
    rows, line = [], []
    for s in slots:
        line.append(InlineKeyboardButton(text=s, callback_data=f"{CB_CSLOT}:{day}|{s}"))
        if len(line) == 3:
            rows.append(line)
            line = []
    if line:
        rows.append(line)
    back_ym = int(day[:7].replace("-", ""))
    rows.append([InlineKeyboardButton(text="⬅️ К календарю", callback_data=f"{CB_CCAL}:{back_ym}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def confirm_kb(day: str, slot: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"{CB_CCF}:{day}|{slot}"),
         InlineKeyboardButton(text="❌ Отменить", callback_data=CB_CCN)],
    ])


def my_bookings_kb(bookings: list) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(
        text=f"❌ {fmt_dmy(date.fromisoformat(b['date']))} {b['time']}",
        callback_data=f"{CB_CANCELQ}:{b['id']}")] for b in bookings]
    rows.append([InlineKeyboardButton(text="⬅️ В меню", callback_data=CB_MAIN)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def cancel_confirm_kb(bid: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Да, отменить", callback_data=f"{CB_CANCEL2}:{bid}"),
         InlineKeyboardButton(text="↩️ Нет, оставить", callback_data=CB_MINE)],
    ])


def back_kb(callback: str, text: str = "⬅️ Назад") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=text, callback_data=callback)]])


# ---------- владелец ----------

def admin_calendar_kb(year: int, month: int, min_ym: int, max_ym: int,
                      counts: dict[date, int]) -> InlineKeyboardMarkup:
    day_cb: dict[date, str | None] = {}
    day_label: dict[date, str] = {}
    days = pycal.monthrange(year, month)[1]
    for dnum in range(1, days + 1):
        d = date(year, month, dnum)
        day_cb[d] = f"{CB_ADAY}:{d.isoformat()}"
        n = counts.get(d, 0)
        day_label[d] = f"{dnum} ·{n}" if n else str(dnum)
    kb = calendar_kb(year, month, min_ym, max_ym, CB_ACAL, day_cb, day_label)
    kb.inline_keyboard.append([InlineKeyboardButton(text="📨 Ближайшие записи", callback_data=CB_NEAREST)])
    kb.inline_keyboard.append([
        InlineKeyboardButton(text="👥 Клиенты", callback_data=f"{CB_ACL}:0"),
        InlineKeyboardButton(text="🚫 Заблокированные", callback_data=CB_BLOCKED),
    ])
    return kb


def client_calendar_kb(year: int, month: int, min_ym: int, max_ym: int,
                       free_days: set[date], today: date) -> InlineKeyboardMarkup:
    day_cb: dict[date, str | None] = {}
    day_label: dict[date, str] = {}
    days = pycal.monthrange(year, month)[1]
    for dnum in range(1, days + 1):
        d = date(year, month, dnum)
        if d < today or d not in free_days:
            day_cb[d] = None
            day_label[d] = "·"
        else:
            day_cb[d] = f"{CB_CDAY}:{d.isoformat()}"
            day_label[d] = str(dnum)
    return calendar_kb(year, month, min_ym, max_ym, CB_CCAL, day_cb, day_label)


def admin_day_kb(day_iso: str, bookings: list) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(
        text=f"❌ {b['time']} — {(b['user_name'] or 'клиент')[:18]}",
        callback_data=f"{CB_ABK}:{b['id']}")] for b in bookings]
    rows.append([InlineKeyboardButton(text="⬅️ К календарю", callback_data=f"{CB_ACAL}:{day_iso[:7].replace('-', '')}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def booking_detail_kb(booking_id: int, user_id: int, user_blocked: bool, day_iso: str) -> InlineKeyboardMarkup:
    blk_label = "✅ Разблокировать клиента" if user_blocked else "🚫 Заблокировать клиента"
    ret = f"bk:{booking_id}"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🗑 Отменить запись", callback_data=f"{CB_AUPD}:{booking_id}")],
        [InlineKeyboardButton(text=blk_label, callback_data=f"{CB_BLK}:{user_id}:{ret}")],
        [InlineKeyboardButton(text="⬅️ К расписанию дня", callback_data=f"{CB_ADAY}:{day_iso}")],
    ])


def admin_cancel_confirm_kb(booking_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Да, отменить и уведомить клиента",
                              callback_data=f"{CB_AUP2}:{booking_id}")],
        [InlineKeyboardButton(text="↩️ Нет, вернуть", callback_data=f"{CB_ABK}:{booking_id}")],
    ])


def clients_kb(users: list, page: int, pages: int, blocked_ids: set[int]) -> InlineKeyboardMarkup:
    rows = []
    for u in users:
        mark = "🚫" if u["tg_id"] in blocked_ids else "👤"
        name = u["name"] or f"id{u['tg_id']}"
        rows.append([InlineKeyboardButton(
            text=f"{mark} {name} — записей: {u['active_bookings']}",
            callback_data=f"{CB_ACLU}:{u['tg_id']}")])
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="◀️", callback_data=f"{CB_ACL}:{page - 1}"))
    if pages > 1:
        nav.append(InlineKeyboardButton(text=f"{page + 1}/{pages}", callback_data=CB_NOOP))
    if page < pages - 1:
        nav.append(InlineKeyboardButton(text="▶️", callback_data=f"{CB_ACL}:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([InlineKeyboardButton(text="⬅️ В панель", callback_data=f"{CB_ACAL}:{_current_ym()}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def client_detail_kb(user_id: int, is_blocked: bool) -> InlineKeyboardMarkup:
    blk_label = "✅ Разблокировать" if is_blocked else "🚫 Заблокировать"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=blk_label, callback_data=f"{CB_BLK}:{user_id}:cd:{user_id}")],
        [InlineKeyboardButton(text="⬅️ К списку клиентов", callback_data=f"{CB_ACL}:0")],
    ])


def blocked_kb(users: list) -> InlineKeyboardMarkup:
    rows = []
    for u in users:
        name = u["name"] or f"id{u['tg_id']}"
        rows.append([InlineKeyboardButton(
            text=f"✅ {name} — разблокировать",
            callback_data=f"{CB_BLK}:{u['tg_id']}:bl")])
    rows.append([InlineKeyboardButton(text="⬅️ В панель", callback_data=f"{CB_ACAL}:{_current_ym()}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def nearest_kb(bookings: list) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(
        text=f"❌ {fmt_dmy(date.fromisoformat(b['date']))} {b['time']} — {(b['user_name'] or 'клиент')[:18]}",
        callback_data=f"{CB_ABK}:{b['id']}")] for b in bookings]
    rows.append([InlineKeyboardButton(text="⬅️ В панель", callback_data=f"{CB_ACAL}:{_current_ym()}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _current_ym() -> int:
    today = local_today()
    return today.year * 100 + today.month
