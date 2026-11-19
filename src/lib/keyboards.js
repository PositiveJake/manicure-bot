import { pad2 } from './config.js';
import { WEEKDAYS_RU, fmtDmy, daysInMonth, weekdayIndex, monthTitle, currentYm, ymOfYmd } from './dates.js';

// Все inline-клавиатуры. Префиксы callback-данных должны совпадать с роутером
// в handlers/callback_query.js — там же они и разбираются.

export const CB = {
  NOOP: 'noop',
  MAIN: 'menu:main',
  BOOK: 'menu:book',
  MINE: 'menu:mine',
  PHONE: 'menu:phone',
  PHONE_CANCEL: 'phone:cancel',
  ADMIN: 'menu:admin',
  CCAL: 'ccal',     // календарь клиента: ccal:YYYYMM
  CDAY: 'cday',     // слоты клиента: cday:YYYY-MM-DD
  CSLOT: 'cslot',   // выбор слота: cslot:YYYY-MM-DD|HH:MM
  CCF: 'ccf',       // подтверждение: ccf:YYYY-MM-DD|HH:MM
  CCN: 'ccn',
  CANCELQ: 'cancelq', // вопрос об отмене: cancelq:<id>
  CANCEL2: 'cancel2', // отмена подтверждена: cancel2:<id>
  ACAL: 'acal',     // календарь владельца: acal:YYYYMM
  ADAY: 'aday',     // день владельца: aday:YYYY-MM-DD
  ABK: 'abk',       // карточка записи: abk:<id>
  AUPD: 'aupd',     // вопрос об отмене владельцем: aupd:<id>
  AUP2: 'aup2',     // отмена подтверждена владельцем: aup2:<id>
  BLK: 'blk',       // блокировка: blk:<uid>:<куда вернуться>
  ACL: 'acl',       // список клиентов: acl:<page>
  ACLU: 'aclu',     // карточка клиента: aclu:<uid>
  NEAREST: 'nearest',
  FREE: 'freewindows',
  NEXT_MONTH: 'nextmonth',
  NEXT_DAY: 'nextday',
  NEXT_SLOT: 'nextslot',
  BLOCKED: 'blocked',
};

const btn = (text, callback_data) => ({ text, callback_data });
const kb = (rows) => ({ inline_keyboard: rows });
export const PHONE_HOME = '🏠 В главное меню';
export const REMOVE_PHONE_KEYBOARD = { remove_keyboard: true };
const home = () => btn(PHONE_HOME, CB.MAIN);

export function mainMenuKb(isOwn) {
  const rows = [[btn('📅 Записаться', CB.BOOK)]];
  if (isOwn) rows.push([btn('🛠 Панель владельца', CB.ADMIN)]);
  rows.push([btn('📋 Мои записи', CB.MINE), btn('📞 Мой телефон', CB.PHONE)]);
  return kb(rows);
}

export function phoneKb() {
  return {
    keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }], [{ text: PHONE_HOME }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export function phoneBookingKb(dayIso) {
  return kb([[btn('⬅️ Назад', `${CB.CDAY}:${dayIso}`), home()]]);
}

// dayCb: { 'YYYY-MM-DD': callbackData | null } — null = день недоступен
// dayLabel: { 'YYYY-MM-DD': текст }
export function calendarKb(year, month, minYM, maxYM, navPrefix, dayCb, dayLabel) {
  const ym = year * 100 + month;
  const prevYM = month > 1 ? ym - 1 : (year - 1) * 100 + 12;
  const nextYM = month < 12 ? ym + 1 : (year + 1) * 100 + 1;
  const rows = [[
    btn('◀️', prevYM >= minYM ? `${navPrefix}:${prevYM}` : CB.NOOP),
    btn(monthTitle(ym), CB.NOOP),
    btn('▶️', nextYM <= maxYM ? `${navPrefix}:${nextYM}` : CB.NOOP),
  ]];
  rows.push(WEEKDAYS_RU.map((w) => btn(w, CB.NOOP)));
  const days = daysInMonth(year, month);
  const offset = weekdayIndex(`${year}-${pad2(month)}-01`);
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(btn(' ', CB.NOOP));
  for (let dnum = 1; dnum <= days; dnum++) {
    const d = `${year}-${pad2(month)}-${pad2(dnum)}`;
    cells.push(btn(dayLabel[d] ?? String(dnum), dayCb[d] || CB.NOOP));
  }
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return kb(rows);
}

export function clientCalendarKb(ym, freeDays) {
  const weekdayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const rows = [[btn(monthTitle(ym), CB.NOOP)]];
  for (const day of freeDays) {
    rows.push([btn(`${weekdayNames[weekdayIndex(day)]}, ${fmtDmy(day).slice(0, 5)}`, `${CB.CDAY}:${day}`)]);
  }
  rows.push([home()]);
  return kb(rows);
}

export function adminCalendarKb(year, month, minYM, maxYM, counts) {
  const dayCb = {};
  const dayLabel = {};
  const days = daysInMonth(year, month);
  for (let dnum = 1; dnum <= days; dnum++) {
    const d = `${year}-${pad2(month)}-${pad2(dnum)}`;
    dayCb[d] = `${CB.ADAY}:${d}`;
    const n = counts[d] || 0;
    dayLabel[d] = n ? `${dnum} ·${n}` : String(dnum);
  }
  const markup = calendarKb(year, month, minYM, maxYM, CB.ACAL, dayCb, dayLabel);
  markup.inline_keyboard.push(
    [btn('📨 Ближайшие записи', CB.NEAREST), btn('🟢 Свободные окна', CB.FREE)],
    [btn('🗓 Окна на следующий месяц', CB.NEXT_MONTH)],
  );
  markup.inline_keyboard.push([
    btn('👥 Клиенты', `${CB.ACL}:0`),
    btn('🚫 Заблокированные', CB.BLOCKED),
  ]);
  markup.inline_keyboard.push([home()]);
  return markup;
}

export function slotsKb(dayIso, slots) {
  const rows = [];
  let line = [];
  for (const s of slots) {
    line.push(btn(s, `${CB.CSLOT}:${dayIso}|${s}`));
    if (line.length === 3) { rows.push(line); line = []; }
  }
  if (line.length) rows.push(line);
  rows.push([btn('⬅️ К календарю', `${CB.CCAL}:${ymOfYmd(dayIso)}`), home()]);
  return kb(rows);
}

export function confirmKb(dayIso, slot) {
  return kb([
    [btn('✅ Подтвердить', `${CB.CCF}:${dayIso}|${slot}`)],
    [btn('⬅️ Назад', `${CB.CDAY}:${dayIso}`), home()],
  ]);
}

export function bookingDoneKb() {
  return kb([[btn('📋 Мои записи', CB.MINE), home()]]);
}

export function myBookingsKb(bookings) {
  const rows = bookings.map((b) => [
    btn(`❌ ${fmtDmy(b.date)} ${b.time}`, `${CB.CANCELQ}:${b.id}`),
  ]);
  rows.push([btn('⬅️ В меню', CB.MAIN)]);
  return kb(rows);
}

export function cancelConfirmKb(bookingId) {
  return kb([[
    btn('✅ Да, отменить', `${CB.CANCEL2}:${bookingId}`),
    btn('↩️ Нет, оставить', CB.MINE),
  ]]);
}

export function backKb(text, callback) {
  return kb([[btn(text, callback)]]);
}

export function adminDayKb(dayIso, bookings) {
  const rows = bookings.map((b) => [
    btn(`❌ ${b.time} — ${(b.user_name || 'клиент').slice(0, 18)}`, `${CB.ABK}:${b.id}`),
  ]);
  rows.push([btn('⬅️ К календарю', `${CB.ACAL}:${ymOfYmd(dayIso)}`), home()]);
  return kb(rows);
}

export function bookingDetailKb(bookingId, userId, userBlocked, dayIso) {
  const blkLabel = userBlocked ? '✅ Разблокировать клиента' : '🚫 Заблокировать клиента';
  return kb([
    [btn('🗑 Отменить запись', `${CB.AUPD}:${bookingId}`)],
    [btn(blkLabel, `${CB.BLK}:${userId}:bk:${bookingId}`)],
    [btn('⬅️ К расписанию дня', `${CB.ADAY}:${dayIso}`)],
  ]);
}

export function adminCancelConfirmKb(bookingId) {
  return kb([
    [btn('✅ Да, отменить и уведомить клиента', `${CB.AUP2}:${bookingId}`)],
    [btn('↩️ Нет, вернуть', `${CB.ABK}:${bookingId}`)],
  ]);
}

export function clientsKb(users, page, pages, blockedIds) {
  const rows = users.map((u) => [
    btn(
      `${blockedIds.has(u.tg_id) ? '🚫' : '👤'} ${u.name || `id${u.tg_id}`} — записей: ${u.active_bookings}`,
      `${CB.ACLU}:${u.tg_id}`,
    ),
  ]);
  const nav = [];
  if (page > 0) nav.push(btn('◀️', `${CB.ACL}:${page - 1}`));
  if (pages > 1) nav.push(btn(`${page + 1}/${pages}`, CB.NOOP));
  if (page < pages - 1) nav.push(btn('▶️', `${CB.ACL}:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn('⬅️ В панель', `${CB.ACAL}:${currentYm()}`)]);
  return kb(rows);
}

export function clientDetailKb(userId, isBlocked) {
  const blkLabel = isBlocked ? '✅ Разблокировать' : '🚫 Заблокировать';
  return kb([
    [btn(blkLabel, `${CB.BLK}:${userId}:cd:${userId}`)],
    [btn('⬅️ К списку клиентов', `${CB.ACL}:0`)],
  ]);
}

export function blockedKb(users) {
  const rows = users.map((u) => [
    btn(`✅ ${u.name || `id${u.tg_id}`} — разблокировать`, `${CB.BLK}:${u.tg_id}:bl`),
  ]);
  rows.push([btn('⬅️ В панель', `${CB.ACAL}:${currentYm()}`)]);
  return kb(rows);
}

export function nearestKb(bookings, range, page, hasNext) {
  const filters = [['7', 'На ближайшие 7 дней'], ['30', 'На ближайшие 30 дней'], ['all', 'Все записи']];
  const rows = filters.map(([key, label]) => [
    btn(key === range ? `✓ ${label}` : label, `${CB.NEAREST}:${key}:0`),
  ]);
  rows.push(...bookings.map((b) => [
    btn(`❌ ${fmtDmy(b.date)} ${b.time} — ${(b.user_name || 'клиент').slice(0, 18)}`, `${CB.ABK}:${b.id}`),
  ]));
  if (page > 0 || hasNext) {
    const nav = [];
    if (page > 0) nav.push(btn('◀️', `${CB.NEAREST}:${range}:${page - 1}`));
    nav.push(btn(`Стр. ${page + 1}`, CB.NOOP));
    if (hasNext) nav.push(btn('▶️', `${CB.NEAREST}:${range}:${page + 1}`));
    rows.push(nav);
  }
  rows.push([btn('⬅️ В панель', `${CB.ACAL}:${currentYm()}`), home()]);
  return kb(rows);
}

export function ownerPanelKb() {
  return kb([[btn('⬅️ В панель', CB.ADMIN), home()]]);
}

export function nextMonthKb(days) {
  const rows = days.map(({ date, slots }) => {
    const open = slots.filter(({ status }) => status === 'open').length;
    const label = `${WEEKDAYS_RU[weekdayIndex(date)]}, ${fmtDmy(date).slice(0, 5)} · свободно ${open}`;
    return [btn(label, `${CB.NEXT_DAY}:${date}`)];
  });
  rows.push([btn('⬅️ В панель', CB.ADMIN), home()]);
  return kb(rows);
}

export function nextDayKb(day) {
  const rows = day.slots.map(({ time, status }) => {
    if (status === 'booked') return [btn(`${time} · занято`, CB.NOOP)];
    const isOpen = status === 'open';
    return [btn(isOpen ? `${time} · закрыть` : `${time} · открыть`,
      `${CB.NEXT_SLOT}:${day.date}|${time}|${isOpen ? 1 : 0}`)];
  });
  rows.push([btn('⬅️ К списку дней', CB.NEXT_MONTH), home()]);
  return kb(rows);
}

export function monthNoticeKb(month) {
  return kb([[btn('🗓 Настроить окна', `${CB.NEXT_MONTH}:${month}`)]]);
}
