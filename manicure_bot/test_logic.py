"""Проверки логики бота без обращения к Telegram API.

Запуск:  python test_logic.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import database as dbm
import keyboards as kb
import reminders as rem
import backup as bk
import config
from config import REMINDER_TIME, TIME_SLOTS
from datetime import date, datetime, time, timedelta, timezone

TMP_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_test_tmp.db")


class FakeBot:
    def __init__(self):
        self.sent = []
        self.docs = []

    async def send_message(self, chat_id, text, **kwargs):
        self.sent.append((chat_id, text))

    async def send_document(self, chat_id, document, **kwargs):
        self.docs.append((chat_id, str(document.path)))


def check(name, cond):
    if not cond:
        raise AssertionError(f"FAIL: {name}")
    print(f"  ok: {name}")


async def test_db():
    print("База данных:")
    if os.path.exists(TMP_DB):
        os.remove(TMP_DB)
    db = await dbm.init_db(TMP_DB)
    try:
        await dbm.upsert_user(db, 111, "anna", "Анна")
        await dbm.set_phone(db, 111, "+79990001122")
        await dbm.upsert_user(db, 222, "bob", "Боб")
        u = await dbm.get_user(db, 111)
        check("пользователь создан", u and u["name"] == "Анна" and u["phone"] == "+79990001122")
        check("повторный upsert не теряет телефон",
              (await dbm.upsert_user(db, 111, None, "Анна"), (await dbm.get_user(db, 111))["phone"] == "+79990001122")[1])

        d1 = (date.today() + timedelta(days=3)).isoformat()
        check("слот создаётся", await dbm.create_booking(db, 111, d1, "10:00"))
        check("дубль слота отклоняется", not await dbm.create_booking(db, 222, d1, "10:00"))

        b = await dbm.get_booking(db, 1)
        check("запись с данными клиента", b and b["user_phone"] == "+79990001122" and b["user_name"] == "Анна")

        today = date.today().isoformat()
        now_hm = datetime.now().strftime("%H:%M")
        upcoming = await dbm.get_user_bookings(db, 111, today, now_hm)
        check("активные записи видны", len(upcoming) == 1)

        past = await dbm.create_booking(db, 111, "2020-01-01", "10:00")
        check("прошлая дата сохраняется (история)", past)
        upcoming2 = await dbm.get_user_bookings(db, 111, today, now_hm)
        check("прошлые записи не в активных", len(upcoming2) == 1)

        counts = await dbm.get_day_counts(db, d1, d1)
        check("счётчик по дням", counts.get(d1) == 1)

        await dbm.set_blocked(db, 111, 1)
        blocked = await dbm.list_blocked(db)
        check("блокировка", len(blocked) == 1 and blocked[0]["tg_id"] == 111)
        await dbm.set_blocked(db, 111, 0)
        check("разблокировка", len(await dbm.list_blocked(db)) == 0)

        users = await dbm.list_users(db, today, 8, 0)
        check("список клиентов", len(users) == 2 and users[0]["active_bookings"] == 1)
    finally:
        await db.close()


async def test_reminders():
    print("Напоминания:")
    tomorrow = date.today() + timedelta(days=1)
    day_after = date.today() + timedelta(days=2)

    if os.path.exists(TMP_DB):
        os.remove(TMP_DB)
    db = await dbm.init_db(TMP_DB)
    try:
        # клиент 111: запись завтра 10:00 (напоминание уже должно уйти, т.к. время REMINDER_TIME прошло бы)
        await dbm.upsert_user(db, 111, "anna", "Анна")
        # клиент 222: запись послезавтра (пока не пора)
        await dbm.upsert_user(db, 222, "bob", "Боб")

        due_dt = datetime.combine(date.today(), REMINDER_TIME)  # момент «за день до» для завтрашней записи
        now = due_dt + timedelta(minutes=5)
        await db.execute(
            "INSERT INTO bookings (tg_user_id, date, time, created_at) VALUES (111,?,?,?)",
            (tomorrow.isoformat(), "10:00", now.isoformat()))
        await db.execute(
            "INSERT INTO bookings (tg_user_id, date, time, created_at) VALUES (222,?,?,?)",
            (day_after.isoformat(), "12:00", now.isoformat()))
        # «просроченная» запись: время уже прошло
        await db.execute(
            "INSERT INTO bookings (tg_user_id, date, time, created_at) VALUES (222,?,?,?)",
            ("2020-01-01", "10:00", "2020-01-01T09:00:00"))
        await db.commit()

        bot = FakeBot()
        await rem.send_due_reminders(bot, db, now=now)
        texts = [t for _, t in bot.sent]
        check("клиенту 111 ушло напоминание", any("Анна" not in t and "завтра" in t for _, t in bot.sent if _ == 111))
        check("клиенту 222 рано напоминать", not any(_ == 222 for _, t in bot.sent))
        check("владельцу ушёл дайджест", any("Напоминания отправлены" in t for _, t in bot.sent))
        rows = await dbm.get_unsent_reminders(db, (date.today() - timedelta(days=1)).isoformat(),
                                              (day_after + timedelta(days=2)).isoformat())
        unsent_ids = {r["tg_user_id"] for r in rows}
        check("просроченная запись закрыта, завтрашняя помечена", 222 in unsent_ids and 111 not in unsent_ids)

        # повторный вызов не дублирует
        bot2 = FakeBot()
        await rem.send_due_reminders(bot2, db, now=now)
        check("повторной отправки нет", len(bot2.sent) == 0)

        check("reminder_due работает", rem.reminder_due(tomorrow, now) and not rem.reminder_due(day_after, now))
    finally:
        await db.close()


def test_keyboards():
    print("Клавиатуры:")
    today = date(2026, 10, 11)
    # клиентский календарь: октябрь 2026, свободны 12 и 13
    free = {date(2026, 10, 12), date(2026, 10, 13)}
    kbm = kb.client_calendar_kb(2026, 10, 202610, 202612, free, today)
    flat = [b for row in kbm.inline_keyboard for b in row]
    check("заголовок месяца", any(b.text == "Октябрь 2026" for b in flat))
    check("назад в прошлом месяце недоступна",
          all(b.callback_data == kb.CB_NOOP for b in kbm.inline_keyboard[0] if b.text == "◀️"))
    check("вперёд доступна", any(b.callback_data == f"{kb.CB_CCAL}:202611" for b in flat))
    day_btns = {b.text: b.callback_data for b in flat if b.callback_data and b.callback_data.startswith(kb.CB_CDAY)}
    check("свободные дни кликабельны", day_btns.get("12") == "cday:2026-10-12" and day_btns.get("13") == "cday:2026-10-13")
    # все недоступные дни (прошедшие и занятые) показываются точкой и не нажимаются:
    # 31 день октября − 2 свободных = 29
    dots = [b for b in flat if b.callback_data == kb.CB_NOOP and b.text == "·"]
    check("недоступные дни показаны точками (29)", len(dots) == 29)

    # админский календарь со счётчиками
    counts = {date(2026, 10, 15): 3}
    kba = kb.admin_calendar_kb(2026, 10, 202608, 202612, counts)
    flat_a = [b for row in kba.inline_keyboard for b in row]
    check("день с записями помечен", any(b.text == "15 ·3" and b.callback_data == "aday:2026-10-15" for b in flat_a))
    check("в прошлое листать можно", any(b.callback_data == f"{kb.CB_ACAL}:202609" for b in flat_a))
    check("нижние кнопки панели", any(b.callback_data == kb.CB_NEAREST for b in flat_a)
          and any(b.callback_data == f"{kb.CB_ACL}:0" for b in flat_a))

    # все callback-данные из клавиатур должны попадать в известные префиксы
    known = {"noop", "menu:", "ccal", "cday", "cslot", "ccf", "ccn", "cancelq", "cancel2",
             "acal", "aday", "abk", "aupd", "aup2", "blk", "acl", "aclu", "nearest", "blocked",
             "phone:", "profile:"}
    all_kbs = [kbm, kba, kb.main_menu_kb(True), kb.main_menu_kb(False), kb.slots_kb("2026-10-12", ["10:00"]),
               kb.confirm_kb("2026-10-12", "10:00"), kb.cancel_confirm_kb(1), kb.admin_day_kb("2026-10-12", []),
               kb.booking_detail_kb(1, 5, False, "2026-10-12"), kb.admin_cancel_confirm_kb(1),
               kb.clients_kb([], 0, 1, set()), kb.client_detail_kb(5, False), kb.blocked_kb([]),
               kb.nearest_kb([]), kb.phone_kb()]
    for k in all_kbs:
        for row in k.inline_keyboard:
            for b in row:
                if b.url:
                    continue
                cd = b.callback_data or ""
                assert any(cd == p or cd.startswith(p if p.endswith(":") else p + ":") or cd == "noop"
                           for p in known), f"неизвестный callback: {cd!r} в кнопке {b.text!r}"
    print("  ok: все callback-данные согласованы с обработчиками")

    # слоты по конфигу: 10:00-20:00 шаг 45 мин -> 10:00, 10:45, ..., последний 19:00
    check("слоты строятся верно", TIME_SLOTS[0] == "10:00" and TIME_SLOTS[-1] == "19:00" and len(TIME_SLOTS) == 13)


def test_tz():
    print("Часовой пояс:")
    old_name, old_off = config.TZ_NAME, config.TZ_OFFSET_HOURS
    try:
        config.TZ_NAME = None
        config.TZ_OFFSET_HOURS = "3"
        n = config.local_now()
        check("local_now возвращает наивное время", n.tzinfo is None)
        utc_plus3 = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=3)
        check("смещение +3 часа учтено", abs(n - utc_plus3) < timedelta(minutes=1))
        check("local_today согласован", config.local_today() == n.date())
    finally:
        config.TZ_NAME, config.TZ_OFFSET_HOURS = old_name, old_off


async def test_backup():
    print("Бэкап базы:")
    if os.path.exists(TMP_DB):
        os.remove(TMP_DB)
    db = await dbm.init_db(TMP_DB)
    try:
        await dbm.upsert_user(db, 111, "anna", "Анна")
        bot = FakeBot()
        await bk.send_backup(bot, db, chat_ids=[999])
        check("файл бэкапа отправлен в чат", len(bot.docs) == 1 and bot.docs[0][0] == 999)
        name = os.path.basename(bot.docs[0][1])
        check("имя файла содержит дату", name.startswith("bookings_") and name.endswith(".db"))
        check("временный файл удалён после отправки", not os.path.exists(bot.docs[0][1]))

        # копия через тот же SQLite Backup API должна содержать данные
        copy_path = TMP_DB + ".copy"
        import sqlite3
        dest = sqlite3.connect(copy_path)
        try:
            await db.backup(dest)
        finally:
            dest.close()
        con = sqlite3.connect(copy_path)
        n = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        con.close()
        os.remove(copy_path)
        check("копия содержит пользователей", n == 1)
    finally:
        await db.close()


async def main():
    await test_db()
    await test_reminders()
    test_keyboards()
    test_tz()
    await test_backup()
    print("\nВсе проверки пройдены ✅")


asyncio.run(main())
