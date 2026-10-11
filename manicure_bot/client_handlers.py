import re
from datetime import date, datetime, timedelta

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

import database as dbm
from config import BOOKING_MONTHS_AHEAD, CHANNEL_URL, TIME_SLOTS, is_owner, local_now, local_today
from keyboards import (
    CB_BOOK,
    CB_CCF,
    CB_CCAL,
    CB_CCN,
    CB_CDAY,
    CB_CSLOT,
    CB_MAIN,
    CB_MINE,
    CB_NOOP,
    CB_PHONE,
    CB_PHONE_CANCEL,
    CB_CANCEL2,
    CB_CANCELQ,
    cancel_confirm_kb,
    client_calendar_kb,
    confirm_kb,
    fmt_dmy_wd,
    main_menu_kb,
    my_bookings_kb,
    phone_kb,
    slots_kb,
)
from helpers import cb_answer, esc, notify_owners, safe_edit

router = Router()


class Profile(StatesGroup):
    phone = State()


# ---------- общие вычисления ----------

def month_range(ym: int) -> tuple[date, date]:
    year, month = divmod(ym, 100)
    first = date(year, month, 1)
    last = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return first, last


def current_ym() -> int:
    t = local_today()
    return t.year * 100 + t.month


def clamp_ym(ym: int, min_ym: int, max_ym: int) -> int:
    return max(min_ym, min(max_ym, ym))


async def free_slots(db, day_iso: str) -> list[str]:
    busy = {row["time"] for row in await dbm.get_booked_times_between(db, day_iso, day_iso)}
    slots = [s for s in TIME_SLOTS if s not in busy]
    if day_iso == local_today().isoformat():
        now_hm = local_now().strftime("%H:%M")
        slots = [s for s in slots if s >= now_hm]
    return slots


async def render_main_menu(call: CallbackQuery):
    kb = main_menu_kb(is_owner(call.from_user.id))
    if CHANNEL_URL:
        from aiogram.types import InlineKeyboardButton
        kb.inline_keyboard.append([InlineKeyboardButton(text="📣 Наш канал", url=CHANNEL_URL)])
    await safe_edit(call, "💅 <b>Запись на маникюр</b>\n\nВыберите действие:", kb)


async def render_client_calendar(call: CallbackQuery, db, ym: int):
    min_ym = current_ym()
    max_ym = min_ym + BOOKING_MONTHS_AHEAD
    ym = clamp_ym(ym, min_ym, max_ym)
    first, last = month_range(ym)
    booked = await dbm.get_booked_times_between(db, first.isoformat(), last.isoformat())
    busy: dict[str, set] = {}
    for row in booked:
        busy.setdefault(row["date"], set()).add(row["time"])

    today = local_today()
    now_hm = local_now().strftime("%H:%M")
    free_days = set()
    for d in (first + timedelta(days=i) for i in range((last - first).days + 1)):
        if d < today:
            continue
        taken = busy.get(d.isoformat(), set())
        slots = [s for s in TIME_SLOTS if s not in taken and (d != today or s >= now_hm)]
        if slots:
            free_days.add(d)

    kb = client_calendar_kb(first.year, first.month, min_ym, max_ym, free_days, today)
    note = "" if free_days else "\n\n😔 В этом месяце свободных дней нет — листайте вперёд."
    await safe_edit(call, f"📅 Выберите день:{note}", kb)


async def render_slots(call: CallbackQuery, db, day_iso: str):
    try:
        day = date.fromisoformat(day_iso)
    except ValueError:
        await cb_answer(call, "Некорректная дата", show_alert=True)
        return
    slots = await free_slots(db, day_iso)
    if not slots:
        await cb_answer(call, "На этот день свободных слотов уже нет", show_alert=True)
        await render_client_calendar(call, db, day.year * 100 + day.month)
        return
    await safe_edit(call, f"🕒 Свободное время на <b>{fmt_dmy_wd(day)}</b>:", slots_kb(day_iso, slots))


async def render_confirm(call: CallbackQuery, db, day_iso: str, slot: str):
    day = date.fromisoformat(day_iso)
    u = await dbm.get_user(db, call.from_user.id)
    name = (u["name"] if u else None) or call.from_user.full_name
    phone = u["phone"] if u else ""
    text = (
        "🧾 <b>Проверьте запись:</b>\n\n"
        f"📅 {fmt_dmy_wd(day)}\n"
        f"🕒 {slot}\n"
        f"👤 {esc(name)}"
        + (f"\n📞 {esc(phone)}" if phone else "\n📞 телефон не указан (можно добавить через «📞 Мой телефон»)")
        + "\n\nВсё верно?"
    )
    await safe_edit(call, text, confirm_kb(day_iso, slot))


async def render_my_bookings(call: CallbackQuery, db):
    today = local_today()
    now_hm = local_now().strftime("%H:%M")
    bookings = await dbm.get_user_bookings(db, call.from_user.id, today.isoformat(), now_hm)
    if not bookings:
        await safe_edit(call, "📋 Активных записей нет.\n\nЖдём вас в «📅 Записаться»!",
                        main_menu_kb(is_owner(call.from_user.id)))
        return
    lines = [f"• {fmt_dmy_wd(date.fromisoformat(b['date']))} — <b>{b['time']}</b>" for b in bookings]
    await safe_edit(call, "📋 <b>Ваши записи</b>\n\nНажмите на запись, чтобы отменить:\n" + "\n".join(lines),
                    my_bookings_kb(bookings))


# ---------- обработчики ----------

@router.message(Command("start"))
async def cmd_start(msg: Message, db, state: FSMContext):
    await state.clear()
    u = msg.from_user
    existing = await dbm.get_user(db, u.id)
    if not existing:
        await dbm.upsert_user(db, u.id, u.username, u.full_name)
        uname = f" (@{u.username})" if u.username else ""
        await notify_owners(msg.bot, f"🙋 Новый клиент: {esc(u.full_name)}{uname}")
    kb = main_menu_kb(is_owner(u.id))
    if CHANNEL_URL:
        from aiogram.types import InlineKeyboardButton
        kb.inline_keyboard.append([InlineKeyboardButton(text="📣 Наш канал", url=CHANNEL_URL)])
    await msg.answer(
        "💅 <b>Запись на маникюр</b>\n\n"
        "Выберите день и время в разделе «📅 Записаться».\n"
        "За день до визита придёт напоминание.",
        reply_markup=kb,
    )


@router.callback_query(F.data == CB_MAIN)
async def cb_main(call: CallbackQuery, db):
    await dbm.upsert_user(db, call.from_user.id, call.from_user.username, call.from_user.full_name)
    await cb_answer(call)
    await render_main_menu(call)


@router.callback_query(F.data == CB_BOOK)
async def cb_book(call: CallbackQuery, db):
    await cb_answer(call)
    await render_client_calendar(call, db, current_ym())


@router.callback_query(F.data.startswith(CB_CCAL + ":"))
async def cb_client_cal(call: CallbackQuery, db):
    ym = int(call.data.split(":")[1])
    await cb_answer(call)
    await render_client_calendar(call, db, ym)


@router.callback_query(F.data.startswith(CB_CDAY + ":"))
async def cb_client_day(call: CallbackQuery, db):
    await cb_answer(call)
    await render_slots(call, db, call.data.split(":", 1)[1])


@router.callback_query(F.data.startswith(CB_CSLOT + ":"))
async def cb_client_slot(call: CallbackQuery, db):
    # данные вида "cslot:YYYY-MM-DD|HH:MM"
    day_iso, slot = call.data.split(":", 1)[1].split("|")
    await cb_answer(call)
    await render_confirm(call, db, day_iso, slot)


@router.callback_query(F.data.startswith(CB_CCF + ":"))
async def cb_client_confirm(call: CallbackQuery, db):
    payload = call.data.split(":", 1)[1]
    day_iso, slot = payload.split("|")
    ok = await dbm.create_booking(db, call.from_user.id, day_iso, slot)
    if not ok:
        await cb_answer(call, "Увы, это время только что заняли. Выберите другое.", show_alert=True)
        await render_slots(call, db, day_iso)
        return
    await cb_answer(call, "Вы записаны! ✨")
    day = date.fromisoformat(day_iso)
    u = await dbm.get_user(db, call.from_user.id)
    name = (u["name"] if u else None) or call.from_user.full_name
    phone = u["phone"] if u else ""
    kb = main_menu_kb(is_owner(call.from_user.id))
    await safe_edit(
        call,
        "✨ <b>Вы записаны!</b>\n\n"
        f"📅 {fmt_dmy_wd(day)} — <b>{slot}</b>\n\n"
        "За день до сеанса придёт напоминание.\n"
        "Отменить запись можно в «📋 Мои записи».",
        kb,
    )
    uname = f", @{call.from_user.username}" if call.from_user.username else ""
    phone_s = f"\n📞 {esc(phone)}" if phone else ""
    await notify_owners(
        call.bot,
        f"🆕 <b>Новая запись</b>\n👤 {esc(name)}{uname}{phone_s}\n"
        f"📅 {fmt_dmy_wd(day)} — {slot}",
    )


@router.callback_query(F.data == CB_CCN)
async def cb_client_decline(call: CallbackQuery, db):
    await cb_answer(call)
    await render_client_calendar(call, db, current_ym())


@router.callback_query(F.data == CB_MINE)
async def cb_mine(call: CallbackQuery, db):
    await cb_answer(call)
    await render_my_bookings(call, db)


@router.callback_query(F.data.startswith(CB_CANCELQ + ":"))
async def cb_cancel_ask(call: CallbackQuery, db):
    bid = int(call.data.split(":")[1])
    b = await dbm.get_booking(db, bid)
    if not b or b["tg_user_id"] != call.from_user.id:
        await cb_answer(call, "Запись не найдена.", show_alert=True)
        return
    await cb_answer(call)
    await safe_edit(
        call,
        f"Отменить запись\n📅 {fmt_dmy_wd(date.fromisoformat(b['date']))} — {b['time']}?",
        cancel_confirm_kb(bid),
    )


@router.callback_query(F.data.startswith(CB_CANCEL2 + ":"))
async def cb_cancel_do(call: CallbackQuery, db):
    bid = int(call.data.split(":")[1])
    b = await dbm.get_booking(db, bid)
    if not b or b["tg_user_id"] != call.from_user.id:
        await cb_answer(call, "Запись не найдена.", show_alert=True)
        return
    await dbm.delete_booking(db, bid)
    await cb_answer(call, "Запись отменена")
    name = b["user_name"] or "клиент"
    await notify_owners(
        call.bot,
        f"❌ Клиент {esc(name)} отменил запись\n"
        f"📅 {fmt_dmy_wd(date.fromisoformat(b['date']))} — {b['time']}",
    )
    await render_my_bookings(call, db)


# ---------- телефон ----------

@router.callback_query(F.data == CB_PHONE)
async def cb_phone(call: CallbackQuery, state: FSMContext):
    await cb_answer(call)
    await state.set_state(Profile.phone)
    await safe_edit(call, "📞 Отправьте номер телефона одним сообщением,\nнапример: <b>+7 999 000-11-22</b>",
                    phone_kb())


@router.callback_query(F.data == CB_PHONE_CANCEL)
async def cb_phone_cancel(call: CallbackQuery, state: FSMContext):
    await state.clear()
    await cb_answer(call)
    await render_main_menu(call)


@router.message(Profile.phone, F.text)
async def phone_received(msg: Message, state: FSMContext, db):
    cleaned = re.sub(r"[ \-()\t]", "", msg.text.strip())
    if not re.fullmatch(r"\+?\d{7,15}", cleaned):
        await msg.answer("Не похоже на номер 🤔 Отправьте, пожалуйста, например: <b>+7 999 000-11-22</b>")
        return
    await dbm.set_phone(db, msg.from_user.id, cleaned)
    await state.clear()
    kb = main_menu_kb(is_owner(msg.from_user.id))
    await msg.answer("📞 Телефон сохранён.", reply_markup=kb)


@router.message(Profile.phone)
async def phone_other(msg: Message):
    await msg.answer("Отправьте номер текстом, например: <b>+7 999 000-11-22</b>")
