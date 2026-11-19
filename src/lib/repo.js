import { sql } from './d1.js';

// Все запросы к базе. Строки из raw-запросов приходят со snake_case ключами
// (tg_id, user_name, …) — этим же стилем пользуемся во views и хендлерах.
// Каждый вызов асинхронный — всегда await.

function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

// ---------- пользователи ----------

export async function getUser(db, tgId) {
  return await db.get(sql`SELECT * FROM users WHERE tg_id = ${tgId}`);
}

export async function upsertUser(db, tgId, username, name) {
  await db.run(sql`
    INSERT INTO users (tg_id, username, name, created_at)
    VALUES (${tgId}, ${username}, ${name}, ${nowIso()})
    ON CONFLICT(tg_id) DO UPDATE SET
      username = COALESCE(excluded.username, users.username),
      name = COALESCE(excluded.name, users.name)`);
}

export async function setPhone(db, tgId, phone) {
  await db.run(sql`UPDATE users SET phone = ${phone} WHERE tg_id = ${tgId}`);
}

export async function setAwaitingPhone(db, tgId, flag) {
  await db.run(sql`UPDATE users SET awaiting_phone = ${flag ? 1 : 0} WHERE tg_id = ${tgId}`);
}

export async function setBlocked(db, tgId, state) {
  await db.run(sql`UPDATE users SET is_blocked = ${state ? 1 : 0} WHERE tg_id = ${tgId}`);
}

// ---------- записи ----------

// False — слот только что занял кто-то другой (уникальный индекс по date+time)
export async function createBooking(db, tgId, dateIso, time, isOwner = false) {
  const res = await db.run(sql`
    INSERT INTO bookings (tg_user_id, date, time, created_at)
    SELECT tg_id, ${dateIso}, ${time}, ${nowIso()}
    FROM users WHERE tg_id = ${tgId} AND (is_blocked = 0 OR ${isOwner ? 1 : 0})
    ON CONFLICT(date, time) DO NOTHING`);
  return res.rowsAffected > 0;
}

export async function getBooking(db, id) {
  return await db.get(sql`
    SELECT b.*, u.name AS user_name, u.phone AS user_phone,
           u.username AS user_username, u.is_blocked AS user_blocked
    FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id
    WHERE b.id = ${id}`);
}

export async function deleteBooking(db, id) {
  const result = await db.run(sql`DELETE FROM bookings WHERE id = ${id}`);
  return result.rowsAffected > 0;
}

export async function getUserBookings(db, tgId, todayIso, nowHm) {
  return await db.all(sql`
    SELECT * FROM bookings
    WHERE tg_user_id = ${tgId}
      AND (date > ${todayIso} OR (date = ${todayIso} AND time >= ${nowHm}))
    ORDER BY date, time`);
}

export async function getBookedTimesBetween(db, dayFrom, dayTo) {
  return await db.all(sql`
    SELECT date, time FROM bookings WHERE date BETWEEN ${dayFrom} AND ${dayTo}`);
}

export async function getDayCounts(db, dayFrom, dayTo) {
  return await db.all(sql`
    SELECT date, COUNT(*) AS n FROM bookings
    WHERE date BETWEEN ${dayFrom} AND ${dayTo} GROUP BY date`);
}

export async function getBookingsForDay(db, dayIso) {
  return await db.all(sql`
    SELECT b.*, u.name AS user_name, u.phone AS user_phone, u.username AS user_username
    FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id
    WHERE b.date = ${dayIso} ORDER BY b.time`);
}

export async function getBookingsBetween(db, dayFrom, dayTo, limit = 50) {
  return await db.all(sql`
    SELECT b.*, u.name AS user_name, u.phone AS user_phone, u.username AS user_username
    FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id
    WHERE b.date BETWEEN ${dayFrom} AND ${dayTo}
    ORDER BY b.date, b.time LIMIT ${limit}`);
}

export async function getUnsentReminders(db, today, time, lastDay, now, limit) {
  return await db.all(sql`
    SELECT b.*, u.name AS user_name, u.phone AS user_phone, u.username AS user_username
    FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id
    WHERE b.reminder_sent = 0 AND b.reminder_claim_until <= ${now}
      AND b.date BETWEEN ${today} AND ${lastDay}
      AND (b.date > ${today} OR b.time > ${time})
    ORDER BY b.reminder_claim_until, b.date, b.time LIMIT ${limit}`);
}

export async function claimReminder(db, id, now, until) {
  return await db.get(sql`
    UPDATE bookings SET reminder_claim_until = ${until}
    WHERE id = ${id} AND reminder_sent = 0 AND reminder_claim_until <= ${now}
    RETURNING reminder_chats`);
}

export async function saveReminderProgress(db, id, until, sentChats, complete) {
  const result = await db.run(sql`
    UPDATE bookings
    SET reminder_chats = ${JSON.stringify(sentChats)}, reminder_sent = ${complete ? 1 : 0}
    WHERE id = ${id} AND reminder_claim_until = ${until}`);
  return result.rowsAffected > 0;
}

// ---------- списки клиентов ----------

export async function listUsersPage(db, todayIso, limit, offset) {
  return await db.all(sql`
    SELECT u.*,
      (SELECT COUNT(*) FROM bookings b
       WHERE b.tg_user_id = u.tg_id AND b.date >= ${todayIso}) AS active_bookings
    FROM users u ORDER BY u.name LIMIT ${limit} OFFSET ${offset}`);
}

export async function countUsers(db) {
  const row = await db.get(sql`SELECT COUNT(*) AS n FROM users`);
  return row ? row.n : 0;
}

export async function listBlocked(db) {
  return await db.all(sql`SELECT * FROM users WHERE is_blocked = 1 ORDER BY name`);
}

export async function allBookingsForExport(db) {
  return await db.all(sql`
    SELECT b.id, b.date, b.time, b.reminder_sent, b.created_at,
           u.name AS user_name, u.phone AS user_phone, u.username AS user_username, u.tg_id
    FROM bookings b JOIN users u ON u.tg_id = b.tg_user_id
    ORDER BY b.date, b.time LIMIT 5000`);
}
