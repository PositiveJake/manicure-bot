import { ADMIN_MONTHS_AHEAD, ADMIN_MONTHS_BACK } from './config.js';
import {
  todayIso, nowHm, currentYm, clampYm, ymOfYmd,
  fmtDmyWd, shiftYmd, shiftYm, isValidYmd, nowLocal, ymd, hm, monthBounds,
} from './dates.js';
import { availableDays, freeSlots, readSchedule } from './availability.js';
import * as repo from './repo.js';
import { esc } from './ui.js';
import {
  mainMenuKb, clientCalendarKb, adminCalendarKb, slotsKb, confirmKb,
  myBookingsKb, cancelConfirmKb, adminDayKb, bookingDetailKb,
  adminCancelConfirmKb, clientsKb, clientDetailKb, blockedKb, nearestKb,
  freeWindowsKb, nextMonthKb, nextDayKb,
} from './keyboards.js';

export { freeSlots, isBookableSlot } from './availability.js';

const CLIENTS_PER_PAGE = 8;
const BOOKINGS_PER_PAGE = 8;
const FREE_DAYS_PER_PAGE = 12;

// ---------- клиент ----------

export async function renderMainMenu(ctx) {
  await ctx.editMsg('💅 <b>Запись на маникюр</b>\n\nВыберите действие:', mainMenuKb(ctx.isOwner));
}

export async function renderClientCalendar(ctx) {
  const now = nowLocal();
  const month = ymOfYmd(ymd(now));
  const days = await availableDays(ctx.db, now, monthBounds(month).last);
  const text = days.length ? '📅 Выберите рабочий день.' : '📅 На этот месяц свободных дней нет.';
  await ctx.editMsg(text, clientCalendarKb(month, days.map(({ date }) => date)));
}

export async function renderSlots(ctx, chatId, messageId, dayIso, alertViaAnswer) {
  const { db } = ctx;
  const slots = await freeSlots(db, dayIso);
  if (!slots.length) {
    if (alertViaAnswer) await ctx.answerCb('На этот день свободных слотов уже нет', true);
    await renderClientCalendar(ctx);
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
  const maxYM = shiftYm(todayYM, ADMIN_MONTHS_AHEAD);
  ym = clampYm(ym, minYM, maxYM);
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  const { first, last } = monthBounds(ym);

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

export async function renderNearest(ctx, range = '30', page = 0) {
  const { db } = ctx;
  const now = nowLocal();
  const today = ymd(now);
  const limit = BOOKINGS_PER_PAGE + 1;
  const load = (offset) => range === 'all' ? repo.getAllBookings(db, limit, offset)
    : repo.getBookingsBetween(db, today, shiftYmd(today, Number(range) - 1), hm(now), limit, offset);
  let bookings = await load(page * BOOKINGS_PER_PAGE);
  if (!bookings.length && page > 0) {
    page = 0;
    bookings = await load(0);
  }
  const visible = bookings.slice(0, BOOKINGS_PER_PAGE);
  const lines = visible.map((b) => {
    const phone = b.user_phone ? `, ${esc(b.user_phone)}` : '';
    return `• ${fmtDmyWd(b.date)} — <b>${b.time}</b> — ${esc(b.user_name || 'клиент')}${phone}`;
  });
  const title = range === 'all' ? 'Все записи' : `Записи на ближайшие ${range} дней`;
  await ctx.editMsg(`📨 <b>${title}</b>\n\n${lines.join('\n') || 'Записей нет.'}`,
    nearestKb(visible, range, page, bookings.length > BOOKINGS_PER_PAGE));
}

export async function renderFreeWindows(ctx, page = 0) {
  const now = nowLocal();
  const month = ymOfYmd(ymd(now));
  const days = await availableDays(ctx.db, now, monthBounds(month).last);
  const pages = Math.max(1, Math.ceil(days.length / FREE_DAYS_PER_PAGE));
  page = Math.max(0, Math.min(page, pages - 1));
  const start = page * FREE_DAYS_PER_PAGE;
  const lines = days.slice(start, start + FREE_DAYS_PER_PAGE)
    .map(({ date, times }) => `• ${fmtDmyWd(date)} — <b>${times.join(', ')}</b>`);
  await ctx.editMsg(`🟢 <b>Свободные окна до конца месяца</b>\n\n${lines.join('\n') || 'Свободных окон нет.'}`,
    freeWindowsKb(page, pages));
}

export async function renderNextMonth(ctx, month) {
  const { first, last } = monthBounds(month);
  const days = await readSchedule(ctx.db, first, last, { editable: true });
  await ctx.editMsg('🗓 <b>Окна на следующий месяц</b>\n\n' +
    `Выберите любую дату. Зелёным отмечены дни с выбранными окнами.\n` +
    `Запись откроется ${fmtDmyWd(first)} по московскому времени.`, nextMonthKb(month, days));
}

export async function renderNextDay(ctx, day, month) {
  const [schedule] = isValidYmd(day) && ymOfYmd(day) === month
    ? await readSchedule(ctx.db, day, day, { editable: true }) : [];
  if (!schedule) {
    await renderNextMonth(ctx, month);
    return;
  }
  await ctx.editMsg(`🗓 <b>${fmtDmyWd(day)}</b>\n\nНажмите на время, чтобы выбрать или снять окно. Зелёные окна откроются для записи. 🔒 — занято.`, nextDayKb(schedule));
}
