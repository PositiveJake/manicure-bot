import os

import aiosqlite
from aiosqlite import Connection
from sqlite3 import IntegrityError

# На хостинге (Railway) укажите DB_PATH=/data/bookings.db и подключите том к /data,
# чтобы база сохранялась между перезапусками
DB_PATH = os.getenv("DB_PATH", "bookings.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    tg_id      INTEGER PRIMARY KEY,
    username   TEXT,
    name       TEXT,
    phone      TEXT NOT NULL DEFAULT '',
    is_blocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_user_id    INTEGER NOT NULL,
    date          TEXT NOT NULL,
    time          TEXT NOT NULL,
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT,
    UNIQUE (date, time)
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(tg_user_id);
"""


async def _ensure_column(db: Connection, table: str, column: str, ddl: str):
    cur = await db.execute(f"PRAGMA table_info({table})")
    cols = {row[1] for row in await cur.fetchall()}
    if column not in cols:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


async def init_db(path: str | None = None) -> Connection:
    path = path or DB_PATH
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    db = await aiosqlite.connect(path)
    db.row_factory = aiosqlite.Row
    await db.executescript(SCHEMA)
    # мягкие миграции для баз, созданных старыми версиями бота
    await _ensure_column(db, "users", "phone", "TEXT NOT NULL DEFAULT ''")
    await _ensure_column(db, "users", "created_at", "TEXT")
    await _ensure_column(db, "bookings", "created_at", "TEXT")
    await db.commit()
    return db


# ---------- пользователи ----------

async def get_user(db: Connection, tg_id: int):
    async with db.execute("SELECT * FROM users WHERE tg_id = ?", (tg_id,)) as cur:
        return await cur.fetchone()


async def upsert_user(db: Connection, tg_id: int, username: str | None, name: str | None):
    """Создаёт пользователя, если он новый; обновляет имя/юзернейм, не трогая телефон."""
    await db.execute(
        "INSERT INTO users (tg_id, username, name, created_at) VALUES (?,?,?,?) "
        "ON CONFLICT(tg_id) DO UPDATE SET "
        "username = COALESCE(excluded.username, users.username), "
        "name = COALESCE(excluded.name, users.name)",
        (tg_id, username, name, _now()),
    )
    await db.commit()


async def set_phone(db: Connection, tg_id: int, phone: str):
    await db.execute("UPDATE users SET phone = ? WHERE tg_id = ?", (phone, tg_id))
    await db.commit()


async def set_blocked(db: Connection, tg_id: int, state: int):
    await db.execute("UPDATE users SET is_blocked = ? WHERE tg_id = ?", (state, tg_id))
    await db.commit()


# ---------- записи ----------

def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")


async def create_booking(db: Connection, tg_id: int, day: str, slot: str) -> bool:
    """Создаёт запись. False — слот только что занял кто-то другой."""
    try:
        await db.execute(
            "INSERT INTO bookings (tg_user_id, date, time, created_at) VALUES (?,?,?,?)",
            (tg_id, day, slot, _now()),
        )
        await db.commit()
        return True
    except IntegrityError:
        await db.rollback()
        return False


async def get_booking(db: Connection, booking_id: int):
    async with db.execute(
        "SELECT b.*, u.name AS user_name, u.phone AS user_phone, "
        "u.username AS user_username, u.is_blocked AS user_blocked "
        "FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id WHERE b.id = ?",
        (booking_id,),
    ) as cur:
        return await cur.fetchone()


async def delete_booking(db: Connection, booking_id: int):
    await db.execute("DELETE FROM bookings WHERE id = ?", (booking_id,))
    await db.commit()


async def get_user_bookings(db: Connection, tg_id: int, today: str, now_hm: str) -> list:
    """Активные (не прошедшие) записи клиента."""
    async with db.execute(
        "SELECT * FROM bookings WHERE tg_user_id = ? AND "
        "(date > ? OR (date = ? AND time >= ?)) ORDER BY date, time",
        (tg_id, today, today, now_hm),
    ) as cur:
        return await cur.fetchall()


async def get_booked_times_between(db: Connection, day_from: str, day_to: str) -> list:
    async with db.execute(
        "SELECT date, time FROM bookings WHERE date BETWEEN ? AND ?", (day_from, day_to)
    ) as cur:
        return await cur.fetchall()


async def get_day_counts(db: Connection, day_from: str, day_to: str) -> dict[str, int]:
    async with db.execute(
        "SELECT date, COUNT(*) AS n FROM bookings WHERE date BETWEEN ? AND ? GROUP BY date",
        (day_from, day_to),
    ) as cur:
        return {row["date"]: row["n"] for row in await cur.fetchall()}


async def get_bookings_for_day(db: Connection, day: str) -> list:
    async with db.execute(
        "SELECT b.*, u.name AS user_name, u.phone AS user_phone, "
        "u.username AS user_username FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id "
        "WHERE b.date = ? ORDER BY b.time", (day,),
    ) as cur:
        return await cur.fetchall()


async def get_bookings_between(db: Connection, day_from: str, day_to: str, limit: int = 50) -> list:
    async with db.execute(
        "SELECT b.*, u.name AS user_name, u.phone AS user_phone, "
        "u.username AS user_username FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id "
        "WHERE b.date BETWEEN ? AND ? ORDER BY b.date, b.time LIMIT ?",
        (day_from, day_to, limit),
    ) as cur:
        return await cur.fetchall()


async def get_unsent_reminders(db: Connection, day_from: str, day_to: str) -> list:
    async with db.execute(
        "SELECT b.*, u.name AS user_name, u.phone AS user_phone, "
        "u.username AS user_username FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id "
        "WHERE b.reminder_sent = 0 AND b.date BETWEEN ? AND ? ORDER BY b.date, b.time",
        (day_from, day_to),
    ) as cur:
        return await cur.fetchall()


async def mark_reminder_sent(db: Connection, booking_id: int):
    await db.execute("UPDATE bookings SET reminder_sent = 1 WHERE id = ?", (booking_id,))
    await db.commit()


# ---------- списки клиентов ----------

async def list_users(db: Connection, today: str, limit: int, offset: int) -> list:
    async with db.execute(
        "SELECT u.*, (SELECT COUNT(*) FROM bookings b WHERE b.tg_user_id = u.tg_id "
        "AND b.date >= ?) AS active_bookings "
        "FROM users u ORDER BY u.name LIMIT ? OFFSET ?",
        (today, limit, offset),
    ) as cur:
        return await cur.fetchall()


async def count_users(db: Connection) -> int:
    async with db.execute("SELECT COUNT(*) AS n FROM users") as cur:
        row = await cur.fetchone()
    return row["n"] if row else 0


async def list_blocked(db: Connection) -> list:
    async with db.execute(
        "SELECT * FROM users WHERE is_blocked = 1 ORDER BY name"
    ) as cur:
        return await cur.fetchall()
