import { TZ_OFFSET_HOURS, pad2 } from './config.js';

// Местное время салона представлено так: Date, сдвинутый на TZ_OFFSET_HOURS,
// «местные» поля читаем через getUTC*. Все даты — строки 'YYYY-MM-DD'.

export const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function nowLocal() {
  return new Date(Date.now() + TZ_OFFSET_HOURS * 3600000);
}

export function ymd(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function hm(d) {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function todayIso() {
  return ymd(nowLocal());
}

export function nowHm() {
  return hm(nowLocal());
}

export function dateFromYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function shiftYmd(s, days) {
  const d = dateFromYmd(s);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

export function ymOfYmd(s) {
  const [y, m] = s.split('-').map(Number);
  return y * 100 + m;
}

export function currentYm() {
  return ymOfYmd(todayIso());
}

export function shiftYm(ym, months) {
  const date = new Date(Date.UTC(Math.floor(ym / 100), ym % 100 - 1 + months, 1));
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
}

export function clampYm(ym, lo, hi) {
  return Math.max(lo, Math.min(hi, ym));
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 0 = понедельник … 6 = воскресенье
export function weekdayIndex(ymdStr) {
  return (dateFromYmd(ymdStr).getUTCDay() + 6) % 7;
}

export function fmtDmy(s) {
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtDmyWd(s) {
  return `${fmtDmy(s)}, ${WEEKDAYS_RU[weekdayIndex(s)].toLowerCase()}`;
}

export function monthTitle(ym) {
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  return `${MONTHS_RU[month - 1]} ${year}`;
}

export function isValidYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = dateFromYmd(s);
  return ymd(d) === s;
}
