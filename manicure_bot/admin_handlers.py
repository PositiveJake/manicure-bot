import asyncio
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import date, timedelta

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

import database as dbm
from backup import send_backup
from config import ADMIN_MONTHS_BACK, is_owner, local_today
from keyboards import (
    CB_ABK,
    CB_ACL,
    CB_ACLU,
    CB_ACAL,
    CB_ADAY,
    CB_ADMIN,
    CB_AUP2,
    CB_AUPD,
    CB_BLK,
    CB_BLOCKED,
    CB_NEAREST,
    CB_NOOP,
    admin_calendar_kb,
    admin_cancel_confirm_kb,
    admin_day_kb,
    blocked_kb,
    booking_detail_kb,
    client_detail_kb,
    clients_kb,
    fmt_dmy_wd,
    nearest_kb,
)
from helpers import cb_answer, esc, notify_owners, safe_edit

router = Router()

CLIENTS_PER_PAGE = 8


async def deny(call: CallbackQuery) -> bool:
    if not is_owner(call.from_user.id):
        await cb_answer(call, "Раздел доступен только владельцу.", show_alert=True)
        return True
    return False


@router.message(Command("backup"))
async def cmd_backup(msg: Message, db):
    """Отправляет владельцу файл базы данных (кнопки и записи восстанавливаются из него)."""
    if not is_owner(msg.from_user.id):
        await msg.answer("Команда доступна только владельцу.")
        return
    await msg.answer("📤 Готовлю резервную копию базы…")
    await send_backup(msg.bot, db, chat_ids=[msg.from_user.id])


@router.message(F.document)
async def doc_restore(msg: Message, db):
    """Восстановление базы: владелец пересылает боту файл, полученный через /backup."""
    if not is_owner(msg.from_user.id):
        return
    doc = msg.document
    fname = doc.file_name or ""
    if not (fname.endswith(".db") or fname.endswith(".sqlite")):
        await msg.answer(
            "Это выглядит как восстановление базы 📥\n"
            "Пришлите файл базы, который бот присылает командой /backup "
            "(имя файла должно заканчиваться на .db)."
        )
        return

    tmp_dir = tempfile.mkdtemp(prefix="manicure_restore_")
    tmp_path = os.path.join(tmp_dir, "restore.db")
    try:
        await msg.bot.download(doc, destination=tmp_path)
        con = sqlite3.connect(tmp_path)
        try:
            tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            con.close()
        if not ({"users", "bookings"} <= tables and integrity == "ok"):
            await msg.answer("⚠️ Файл не похож на корректную базу бота. Восстановление отменено.")
            return
    except sqlite3.DatabaseError:
        await msg.answer("⚠️ Файл повреждён или это не база SQLite. Восстановление отменено.")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return

    await msg.answer("✅ База проверена. Сохраняю и перезапускаю бота…")
    await db.close()
    os.replace(tmp_path, dbm.DB_PATH)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    await asyncio.sleep(1)
    # перезапуск процесса: новый коннект откроет восстановленную базу
    os.execv(sys.executable, [sys.executable, os.path.abspath(sys.argv[0])])


# ---------- рендеры ----------

async def render_admin_calendar(call: CallbackQuery, db, ym: int):
    today = local_today()
    min_ym = today.year * 100 + today.month - ADMIN_MONTHS_BACK
    max_ym = today.year * 100 + today.month + 2
    ym = max(min_ym, min(max_ym, ym))
    year, month = divmod(ym, 100)
    first = date(year, month, 1)
    last = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    counts_raw = await dbm.get_day_counts(db, first.isoformat(), last.isoformat())
    counts = {date.fromisoformat(k): v for k, v in counts_raw.items()}
    kb = admin_calendar_kb(first.year, first.month, min_ym, max_ym, counts)
    total = sum(counts.values())
    text = (
        "🛠 <b>Панель владельца</b>\n\n"
        "📅 Календарь записей (число после «·» — количество записей в день):"
    )
    if total:
        text += f"\nВ этом месяце записей: <b>{total}</b>"
    await safe_edit(call, text, kb)


async def render_day(call: CallbackQuery, db, day_iso: str):
    try:
        day = date.fromisoformat(day_iso)
    except ValueError:
        await cb_answer(call, "Некорректная дата", show_alert=True)
        return
    bookings = await dbm.get_bookings_for_day(db, day_iso)
    if not bookings:
        await safe_edit(
            call,
            f"📅 {fmt_dmy_wd(day)}:\n\nзаписей нет",
            admin_day_kb(day_iso, []),
        )
        return
    lines = []
    for b in bookings:
        who = b["user_name"] or "клиент"
        phone = f", {b['user_phone']}" if b["user_phone"] else ""
        lines.append(f"• <b>{b['time']}</b> — {esc(who)}{phone}")
    await safe_edit(call, f"📅 {fmt_dmy_wd(day)}:\n\n" + "\n".join(lines), admin_day_kb(day_iso, bookings))


async def render_booking_detail(call: CallbackQuery, db, bid: int):
    b = await dbm.get_booking(db, bid)
    if not b:
        await cb_answer(call, "Запись не найдена (возможно, уже отменена).", show_alert=True)
        return
    name = b["user_name"] or "имя не указано"
    username = f"@{b['user_username']}" if b["user_username"] else "—"
    phone = b["user_phone"] or "—"
    text = (
        "🗓 <b>Запись</b>\n\n"
        f"📅 {fmt_dmy_wd(date.fromisoformat(b['date']))} — <b>{b['time']}</b>\n"
        f"👤 {esc(name)}\n"
        f"💬 {esc(username)}\n"
        f"📞 {esc(phone)}\n"
        f"🆔 {b['tg_user_id']}"
    )
    await safe_edit(call, text, booking_detail_kb(b["id"], b["tg_user_id"], bool(b["user_blocked"]), b["date"]))


async def render_clients_list(call: CallbackQuery, db, page: int):
    total = await dbm.count_users(db)
    pages = max(1, (total + CLIENTS_PER_PAGE - 1) // CLIENTS_PER_PAGE)
    page = max(0, min(page, pages - 1))
    users = await dbm.list_users(db, local_today().isoformat(), CLIENTS_PER_PAGE, page * CLIENTS_PER_PAGE)
    blocked_ids = {u["tg_id"] for u in await dbm.list_blocked(db)}
    if not users:
        await safe_edit(call, "👥 Клиентов пока нет.", clients_kb([], 0, 1, blocked_ids))
        return
    await safe_edit(
        call,
        f"👥 <b>Клиенты</b> (всего {total})\n\nНажмите на клиента, чтобы посмотреть карточку:",
        clients_kb(users, page, pages, blocked_ids),
    )


async def render_client_detail(call: CallbackQuery, db, uid: int):
    u = await dbm.get_user(db, uid)
    if not u:
        await cb_answer(call, "Клиент не найден.", show_alert=True)
        return
    today = local_today()
    bookings = await dbm.get_user_bookings(db, uid, today.isoformat(), "00:00")
    name = u["name"] or "имя не указано"
    username = f"@{u['username']}" if u["username"] else "—"
    phone = u["phone"] or "—"
    status = "🚫 заблокирован" if u["is_blocked"] else "✅ активен"
    text = (
        "👤 <b>Карточка клиента</b>\n\n"
        f"Имя: {esc(name)}\n"
        f"Telegram: {esc(username)}\n"
        f"Телефон: {esc(phone)}\n"
        f"Статус: {status}\n"
        f"🆔 {uid}"
    )
    if bookings:
        lines = [f"• {fmt_dmy_wd(date.fromisoformat(b['date']))} — {b['time']}" for b in bookings]
        text += "\n\n📅 Будущие записи:\n" + "\n".join(lines)
        text += "\n\n(управление записями — через календарь и «Ближайшие записи»)"
    await safe_edit(call, text, client_detail_kb(uid, bool(u["is_blocked"])))


async def render_blocked_list(call: CallbackQuery, db):
    users = await dbm.list_blocked(db)
    if not users:
        await safe_edit(call, "🚫 Заблокированных клиентов нет.", blocked_kb([]))
        return
    await safe_edit(call, "🚫 <b>Заблокированные клиенты</b>\n\nНажмите, чтобы разблокировать:", blocked_kb(users))


async def render_nearest(call: CallbackQuery, db):
    today = local_today()
    bookings = await dbm.get_bookings_between(db, today.isoformat(), (today + timedelta(days=6)).isoformat())
    if not bookings:
        await safe_edit(call, "📨 На ближайшие 7 дней записей нет.", nearest_kb([]))
        return
    lines = []
    for b in bookings:
        who = b["user_name"] or "клиент"
        phone = f", {b['user_phone']}" if b["user_phone"] else ""
        lines.append(f"• {fmt_dmy_wd(date.fromisoformat(b['date']))} — <b>{b['time']}</b> — {esc(who)}{phone}")
    await safe_edit(call, "📨 <b>Записи на ближайшие 7 дней:</b>\n\n" + "\n".join(lines), nearest_kb(bookings))


# ---------- обработчики ----------

@router.callback_query(F.data == CB_ADMIN)
async def cb_admin(call: CallbackQuery, db):
    if await deny(call):
        return
    await cb_answer(call)
    from client_handlers import current_ym
    await render_admin_calendar(call, db, current_ym())


@router.callback_query(F.data.startswith(CB_ACAL + ":"))
async def cb_admin_cal(call: CallbackQuery, db):
    if await deny(call):
        return
    try:
        ym = int(call.data.split(":")[1])
    except ValueError:
        ym = 0
    if ym <= 0:
        await cb_answer(call)
        from client_handlers import current_ym
        ym = current_ym()
    await cb_answer(call)
    await render_admin_calendar(call, db, ym)


@router.callback_query(F.data == CB_NEAREST)
async def cb_nearest(call: CallbackQuery, db):
    if await deny(call):
        return
    await cb_answer(call)
    await render_nearest(call, db)


@router.callback_query(F.data.startswith(CB_ADAY + ":"))
async def cb_admin_day(call: CallbackQuery, db):
    if await deny(call):
        return
    await cb_answer(call)
    await render_day(call, db, call.data.split(":", 1)[1])


@router.callback_query(F.data.startswith(CB_ABK + ":"))
async def cb_admin_booking(call: CallbackQuery, db):
    if await deny(call):
        return
    await cb_answer(call)
    await render_booking_detail(call, db, int(call.data.split(":")[1]))


@router.callback_query(F.data.startswith(CB_AUPD + ":"))
async def cb_admin_cancel_ask(call: CallbackQuery, db):
    if await deny(call):
        return
    bid = int(call.data.split(":")[1])
    b = await dbm.get_booking(db, bid)
    if not b:
        await cb_answer(call, "Запись не найдена.", show_alert=True)
        return
    await cb_answer(call)
    await safe_edit(
        call,
        f"Отменить запись клиента?\n\n"
        f"📅 {fmt_dmy_wd(date.fromisoformat(b['date']))} — {b['time']}\n"
        f"👤 {esc(b['user_name'] or 'клиент')}\n\n"
        "Клиенту придёт уведомление об отмене.",
        admin_cancel_confirm_kb(bid),
    )


@router.callback_query(F.data.startswith(CB_AUP2 + ":"))
async def cb_admin_cancel_do(call: CallbackQuery, db):
    if await deny(call):
        return
    bid = int(call.data.split(":")[1])
    b = await dbm.get_booking(db, bid)
    if not b:
        await cb_answer(call, "Запись не найдена.", show_alert=True)
        return
    day_iso = b["date"]
    await dbm.delete_booking(db, bid)
    await cb_answer(call, "Запись отменена, клиент уведомлён")
    try:
        await call.bot.send_message(
            b["tg_user_id"],
            "⚠️ К сожалению, ваша запись отменена мастером:\n"
            f"📅 {fmt_dmy_wd(date.fromisoformat(day_iso))} — {b['time']}\n\n"
            "Выбрать другое время можно в разделе «📅 Записаться».",
        )
    except Exception:
        pass
    await render_day(call, db, day_iso)


@router.callback_query(F.data.startswith(CB_ACLU + ":"))
async def cb_admin_client(call: CallbackQuery, db):
    if await deny(call):
        return
    await cb_answer(call)
    await render_client_detail(call, db, int(call.data.split(":")[1]))


@router.callback_query(F.data.startswith(CB_ACL + ":"))
async def cb_admin_clients_list(call: CallbackQuery, db):
    if await deny(call):
        return
    try:
        page = int(call.data.split(":")[1])
    except ValueError:
        page = 0
    await cb_answer(call)
    await render_clients_list(call, db, page)


@router.callback_query(F.data == CB_BLOCKED)
async def cb_admin_blocked(call: CallbackQuery, db):
    if await deny(call):
        return
    await cb_answer(call)
    await render_blocked_list(call, db)


@router.callback_query(F.data.startswith(CB_BLK + ":"))
async def cb_admin_toggle_block(call: CallbackQuery, db):
    if await deny(call):
        return
    parts = call.data.split(":", 2)  # blk:<uid>:<ret>
    uid = int(parts[1])
    ret = parts[2] if len(parts) > 2 else "cl"
    u = await dbm.get_user(db, uid)
    if not u:
        await cb_answer(call, "Клиент не найден.", show_alert=True)
        return
    new_state = 0 if u["is_blocked"] else 1
    await dbm.set_blocked(db, uid, new_state)
    await cb_answer(call, f"{'Заблокирован' if new_state else 'Разблокирован'}: {u['name'] or uid}")
    if ret == "bl":
        await render_blocked_list(call, db)
    elif ret.startswith("cd:"):
        await render_client_detail(call, db, int(ret.split(":")[1]))
    elif ret.startswith("bk:"):
        await render_booking_detail(call, db, int(ret.split(":")[1]))
    else:
        await render_clients_list(call, db, 0)
