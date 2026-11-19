import { BOOKING_MONTHS_AHEAD, ADMIN_MONTHS_BACK, WORK_SLOTS, APPOINTMENT_MINUTES } from './config.js';
import {
  todayIso, nowHm, currentYm, clampYm, ymOfYmd,
  daysInMonth, fmtDmyWd, shiftYmd, shiftYm, isValidYmd, weekdayIndex, nowLocal, ymd, hm,
} from './dates.js';
import * as repo from './repo.js';
import { esc } from './ui.js';
import {
  mainMenuKb, clientCalendarKb, adminCalendarKb, slotsKb, confirmKb,
  myBookingsKb, cancelConfirmKb, adminDayKb, bookingDetailKb,
  adminCancelConfirmKb, clientsKb, clientDetailKb, blockedKb, nearestKb,
} from './keyboards.js';

const CLIENTS_PER_PAGE = 8;
const BOOKINGS_PER_PAGE = 8;

function isBookableDay(dayIso, today) {
  return isValidYmd(dayIso) && dayIso >= today
    && ymOfYmd(dayIso) <= shiftYm(ymOfYmd(today), BOOKING_MONTHS_AHEAD);
}

function workSlots(dayIso, today, time) {
  const slots = WORK_SLOTS[weekdayIndex(dayIso)] ?? [];
  return dayIso === today ? slots.filter((slot) => slot > time) : slots;
}

function minutes(time) {
  const [hours, minute] = time.split(':').map(Number);
  return hours * 60 + minute;
}

function hasRoom(slot, bookings) {
  const start = minutes(slot);
  return bookings.every((time) => Math.abs(minutes(time) - start) >= APPOINTMENT_MINUTES);
}

export function isBookableSlot(dayIso, slot) {
  const now = nowLocal();
  const today = ymd(now);
  return isBookableDay(dayIso, today) && workSlots(dayIso, today, hm(now)).includes(slot);
}

export async function freeSlots(db, dayIso) {
  const now = nowLocal();
  const today = ymd(now);
  if (!isBookableDay(dayIso, today)) return [];
  const slots = workSlots(dayIso, today, hm(now));
  if (!slots.length) return [];
  const rows = await repo.getBookedTimesBetween(db, dayIso, dayIso);
  const busy = rows.map((r) => r.time);
  return slots.filter((slot) => hasRoom(slot, busy));
}

// ---------- клиент ----------

export async function renderMainMenu(ctx) {
  await ctx.editMsg('💅 <b>Запись на маникюр</b>\n\nВыберите действие:', mainMenuKb(ctx.isOwner));
}

export async function renderClientCalendar(ctx, chatId, messageId, ym) {
  const { db } = ctx;
  const minYM = currentYm();
  const maxYM = shiftYm(minYM, BOOKING_MONTHS_AHEAD);
  ym = clampYm(ym, minYM, maxYM);
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

  const booked = await repo.getBookedTimesBetween(db, first, last);
  const busy = new Map();
  for (const r of booked) {
    if (!busy.has(r.date)) busy.set(r.date, []);
    busy.get(r.date).push(r.time);
  }

  const now = nowLocal();
  const today = ymd(now);
  const nowStr = hm(now);
  const freeDays = [];
  for (let dnum = 1; dnum <= daysInMonth(year, month); dnum++) {
    const d = `${year}-${String(month).padStart(2, '0')}-${String(dnum).padStart(2, '0')}`;
    if (d < today) continue;
    const taken = busy.get(d) ?? [];
    if (workSlots(d, today, nowStr).some((slot) => hasRoom(slot, taken))) freeDays.push(d);
  }

  const markup = clientCalendarKb(ym, minYM, maxYM, freeDays);
  const text = freeDays.length ? '📅 Выберите рабочий день.' : '📅 На этот месяц свободных дней нет.';
  await ctx.editMsg(text, markup);
}

export async function renderSlots(ctx, chatId, messageId, dayIso, alertViaAnswer) {
  const { db } = ctx;
  const slots = await freeSlots(db, dayIso);
  if (!slots.length) {
    if (alertViaAnswer) await ctx.answerCb('На этот день свободных слотов уже нет', true);
    await renderClientCalendar(ctx, chatId, messageId, isValidYmd(dayIso) ? ymOfYmd(dayIso) : currentYm());
    return;
  }
  if (alertViaAnswer) await ctx.answerCb();
  await ctx.editMsg(`🕒 Свободное время на <b>${fmtDmyWd(dayIso)}</b>:`, slotsKb(dayIso, slots));
}

export async function renderConfirm(ctx, dayIso, slot, user) {
  const name = user.name || ctx.fromName || 'клиент';
  const text =
    '🧾 <b>Проверьте запись:</b>\n\n' +
    `📅 ${fmtDmyWd(dayIso)}\n` +
    `🕒 ${slot}\n` +
    `👤 ${esc(name)}\n📞 ${esc(user.phone)}` +
    '\n\nВсё верно?';
  await ctx.editMsg(text, confirmKb(dayIso, slot));
}

export async function renderMyBookings(ctx, chatId, messageId) {
  const { db } = ctx;
  const bookings = await repo.getUserBookings(db, ctx.userId, todayIso(), nowHm());
  if (!bookings.length) {
    await ctx.editMsg('📋 Активных записей нет.\n\nЖдём вас в «📅 Записаться»!', mainMenuKb(ctx.isOwner));
    return;
  }
  const lines = bookings.map((b) => `• ${fmtDmyWd(b.date)} — <b>${b.time}</b>`);
  await ctx.editMsg(
    '📋 <b>Ваши записи</b>\n\nНажмите на запись, чтобы отменить:\n' + lines.join('\n'),
    myBookingsKb(bookings),
  );
}

export async function renderCancelAsk(ctx, chatId, messageId, bookingId) {
  const { db } = ctx;
  const b = await repo.getBooking(db, bookingId);
  if (!b || b.tg_user_id !== ctx.userId) {
    await ctx.answerCb('Запись не найдена.', true);
    return;
  }
  await ctx.editMsg(
    `Отменить запись\n📅 ${fmtDmyWd(b.date)} — ${b.time}?`,
    cancelConfirmKb(bookingId),
  );
}

export async function renderCancelDo(ctx, chatId, messageId, bookingId) {
  const { db, api } = ctx;
  const b = await repo.getBooking(db, bookingId);
  if (!b || b.tg_user_id !== ctx.userId) {
    await ctx.answerCb('Запись не найдена.', true);
    return;
  }
  if (!await repo.deleteBooking(db, bookingId)) {
    await ctx.answerCb('Запись уже отменена.', true);
    return;
  }
  await ctx.answerCb('Запись отменена');
  await ctx.notifyOwners(
    `❌ Клиент ${esc(b.user_name || 'клиент')} отменил запись\n📅 ${fmtDmyWd(b.date)} — ${b.time}`,
  );
  await renderMyBookings(ctx, chatId, messageId);
}

// ---------- владелец ----------

export async function renderAdminCalendar(ctx, chatId, messageId, ym) {
  const { db } = ctx;
  const todayYM = currentYm();
  const minYM = shiftYm(todayYM, -ADMIN_MONTHS_BACK);
  const maxYM = shiftYm(todayYM, BOOKING_MONTHS_AHEAD);
  ym = clampYm(ym, minYM, maxYM);
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

  const countRows = await repo.getDayCounts(db, first, last);
  const counts = {};
  let total = 0;
  for (const r of countRows) { counts[r.date] = r.n; total += r.n; }

  const markup = adminCalendarKb(year, month, minYM, maxYM, counts);
  let text = '🛠 <b>Панель владельца</b>\n\n📅 Календарь записей (число после «·» — количество записей в день):';
  if (total) text += `\nВ этом месяце записей: <b>${total}</b>`;
  await ctx.editMsg(text, markup);
}

export async function renderDay(ctx, chatId, messageId, dayIso) {
  const { db } = ctx;
  const bookings = await repo.getBookingsForDay(db, dayIso);
  if (!bookings.length) {
    await ctx.editMsg(`📅 ${fmtDmyWd(dayIso)}:\n\nзаписей нет`, adminDayKb(dayIso, []));
    return;
  }
  const lines = bookings.map((b) => {
    const phone = b.user_phone ? `, ${b.user_phone}` : '';
    return `• <b>${b.time}</b> — ${esc(b.user_name || 'клиент')}${phone}`;
  });
  await ctx.editMsg(`📅 ${fmtDmyWd(dayIso)}:\n\n${lines.join('\n')}`, adminDayKb(dayIso, bookings));
}

export async function renderBookingDetail(ctx, chatId, messageId, bookingId) {
  const { db } = ctx;
  const b = await repo.getBooking(db, bookingId);
  if (!b) {
    await ctx.answerCb('Запись не найдена (возможно, уже отменена).', true);
    return;
  }
  const username = b.user_username ? `@${b.user_username}` : '—';
  const text =
    '🗓 <b>Запись</b>\n\n' +
    `📅 ${fmtDmyWd(b.date)} — <b>${b.time}</b>\n` +
    `👤 ${esc(b.user_name || 'имя не указано')}\n` +
    `💬 ${esc(username)}\n` +
    `📞 ${esc(b.user_phone || '—')}\n` +
    `🆔 ${b.tg_user_id}`;
  await ctx.editMsg(text, bookingDetailKb(b.id, b.tg_user_id, !!b.user_blocked, b.date));
}

export async function renderAdminCancelAsk(ctx, chatId, messageId, bookingId) {
  const { db } = ctx;
  const b = await repo.getBooking(db, bookingId);
  if (!b) {
    await ctx.answerCb('Запись не найдена.', true);
    return;
  }
  await ctx.editMsg(
    'Отменить запись клиента?\n\n' +
    `📅 ${fmtDmyWd(b.date)} — ${b.time}\n` +
    `👤 ${esc(b.user_name || 'клиент')}\n\n` +
    'Клиенту придёт уведомление об отмене.',
    adminCancelConfirmKb(bookingId),
  );
}

export async function renderAdminCancelDo(ctx, chatId, messageId, bookingId) {
  const { db, api } = ctx;
  const b = await repo.getBooking(db, bookingId);
  if (!b) {
    await ctx.answerCb('Запись не найдена.', true);
    return;
  }
  const dayIso = b.date;
  if (!await repo.deleteBooking(db, bookingId)) {
    await ctx.answerCb('Запись уже отменена.', true);
    return;
  }
  await ctx.answerCb('Запись отменена');
  try {
    await api.sendMessage({
      chat_id: b.tg_user_id,
      parse_mode: 'HTML',
      text:
        '⚠️ К сожалению, ваша запись отменена мастером:\n' +
        `📅 ${fmtDmyWd(dayIso)} — ${b.time}\n\n` +
        'Выбрать другое время можно в разделе «📅 Записаться».',
    });
  } catch (e) {
    console.warn('cancel notice failed:', e?.description || e);
  }
  await renderDay(ctx, chatId, messageId, dayIso);
}

export async function renderClientsList(ctx, chatId, messageId, page) {
  const { db } = ctx;
  const total = await repo.countUsers(db);
  const pages = Math.max(1, Math.ceil(total / CLIENTS_PER_PAGE));
  page = Math.max(0, Math.min(page, pages - 1));
  const users = await repo.listUsersPage(db, todayIso(), CLIENTS_PER_PAGE, page * CLIENTS_PER_PAGE);
  const blockedRows = await repo.listBlocked(db);
  const blockedIds = new Set(blockedRows.map((u) => u.tg_id));
  if (!users.length) {
    await ctx.editMsg('👥 Клиентов пока нет.', clientsKb([], 0, 1, blockedIds));
    return;
  }
  await ctx.editMsg(
    `👥 <b>Клиенты</b> (всего ${total})\n\nНажмите на клиента, чтобы посмотреть карточку:`,
    clientsKb(users, page, pages, blockedIds),
  );
}

export async function renderClientDetail(ctx, chatId, messageId, uid) {
  const { db } = ctx;
  const u = await repo.getUser(db, uid);
  if (!u) {
    await ctx.answerCb('Клиент не найден.', true);
    return;
  }
  const bookings = await repo.getUserBookings(db, uid, todayIso(), '00:00');
  const status = u.is_blocked ? '🚫 заблокирован' : '✅ активен';
  let text =
    '👤 <b>Карточка клиента</b>\n\n' +
    `Имя: ${esc(u.name || 'имя не указано')}\n` +
    `Telegram: ${esc(u.username ? `@${u.username}` : '—')}\n` +
    `Телефон: ${u.phone_verified ? esc(u.phone) : 'номер не подтверждён'}\n` +
    `Статус: ${status}\n` +
    `🆔 ${uid}`;
  if (bookings.length) {
    const lines = bookings.map((b) => `• ${fmtDmyWd(b.date)} — ${b.time}`);
    text += '\n\n📅 Будущие записи:\n' + lines.join('\n');
    text += '\n\n(управление записями — через календарь и «Ближайшие записи»)';
  }
  await ctx.editMsg(text, clientDetailKb(uid, !!u.is_blocked));
}

export async function renderBlockedList(ctx, chatId, messageId) {
  const { db } = ctx;
  const users = await repo.listBlocked(db);
  if (!users.length) {
    await ctx.editMsg('🚫 Заблокированных клиентов нет.', blockedKb([]));
    return;
  }
  await ctx.editMsg('🚫 <b>Заблокированные клиенты</b>\n\nНажмите, чтобы разблокировать:', blockedKb(users));
}

export async function renderNearest(ctx, page = 0) {
  const { db } = ctx;
  const now = nowLocal();
  const today = ymd(now);
  const bookings = await repo.getBookingsBetween(db, today, shiftYmd(today, 29), hm(now));
  if (!bookings.length) {
    await ctx.editMsg('📨 На ближайшие 30 дней записей нет.', nearestKb([]));
    return;
  }
  const pages = Math.ceil(bookings.length / BOOKINGS_PER_PAGE);
  page = Math.max(0, Math.min(page, pages - 1));
  const visible = bookings.slice(page * BOOKINGS_PER_PAGE, (page + 1) * BOOKINGS_PER_PAGE);
  const lines = visible.map((b) => {
    const phone = b.user_phone ? `, ${esc(b.user_phone)}` : '';
    return `• ${fmtDmyWd(b.date)} — <b>${b.time}</b> — ${esc(b.user_name || 'клиент')}${phone}`;
  });
  await ctx.editMsg('📨 <b>Записи на ближайшие 30 дней</b>\n\n' + lines.join('\n'), nearestKb(visible, page, pages));
}
