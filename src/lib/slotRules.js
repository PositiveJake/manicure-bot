import { NEXT_MONTH_BOOKING_DAY, WORK_SLOTS } from './config.js';
import { monthBounds, shiftYm, shiftYmd, weekdayIndex, ymOfYmd } from './dates.js';

export function defaultTimes(day) {
  return WORK_SLOTS[weekdayIndex(day)] ?? [];
}

export function bookingOpensOn(month) {
  const previousMonth = shiftYm(month, -1);
  return shiftYmd(monthBounds(previousMonth).first, NEXT_MONTH_BOOKING_DAY - 1);
}

export function lastBookableMonth(today) {
  const current = ymOfYmd(today);
  const next = shiftYm(current, 1);
  return today >= bookingOpensOn(next) ? next : current;
}
