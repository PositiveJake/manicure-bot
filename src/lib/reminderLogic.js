import { REMINDER_HOUR, REMINDER_MINUTE, pad2 } from './config.js';
import { shiftYmd, fmtDmyWd } from './dates.js';

// Напоминание «за день до»: должно уйти в REMINDER_TIME накануне сеанса
// (или при следующей проверке, если срок уже наступил).

export function whenWord(dateIso, todayIso) {
  if (dateIso === todayIso) return 'сегодня';
  if (dateIso === shiftYmd(todayIso, 1)) return 'завтра';
  return fmtDmyWd(dateIso);
}

function isoMoment(dateIso, h, m) {
  return `${dateIso}T${pad2(h)}:${pad2(m)}`;
}

export function isReminderDue(dateIso, now) {
  const due = isoMoment(shiftYmd(dateIso, -1), REMINDER_HOUR, REMINDER_MINUTE);
  const nowStr = isoMoment(ymdOf(now), now.getUTCHours(), now.getUTCMinutes());
  return due <= nowStr;
}

function ymdOf(shiftedDate) {
  const p = (n) => String(n).padStart(2, '0');
  return `${shiftedDate.getUTCFullYear()}-${p(shiftedDate.getUTCMonth() + 1)}-${p(shiftedDate.getUTCDate())}`;
}

export function clientText(dateIso, time, now) {
  const todayIso = ymdOf(now);
  return (
    '⏰ <b>Напоминание о записи</b>\n\n' +
    `Ваш маникюр — <b>${whenWord(dateIso, todayIso)}</b> в <b>${time}</b>. Ждём вас! 💅\n\n` +
    'Если планы изменились, отмените запись в разделе «📋 Мои записи».'
  );
}
