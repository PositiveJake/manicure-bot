import { WORK_SLOTS, APPOINTMENT_MINUTES } from './config.js';
import { hm, isValidYmd, nowLocal, shiftYmd, weekdayIndex, ymd, ymOfYmd } from './dates.js';
import { getSlotOccupancy } from './repo.js';

export function scheduledTimes(day) {
  return WORK_SLOTS[weekdayIndex(day)] ?? [];
}

export function isBookableSlot(day, slot, now = nowLocal()) {
  const today = ymd(now);
  return isValidYmd(day) && day >= today && ymOfYmd(day) === ymOfYmd(today)
    && scheduledTimes(day).includes(slot) && (day > today || slot > hm(now));
}

function minutes(time) {
  const [hours, minute] = time.split(':').map(Number);
  return hours * 60 + minute;
}

export async function readSchedule(db, first, last) {
  const byDay = new Map();
  for (const row of await getSlotOccupancy(db, first, last)) {
    if (!byDay.has(row.date)) byDay.set(row.date, []);
    byDay.get(row.date).push(row);
  }

  const days = [];
  for (let date = first; date <= last; date = shiftYmd(date, 1)) {
    const taken = byDay.get(date) ?? [];
    const slots = scheduledTimes(date).map((time) => {
      if (taken.some((row) => !row.closed && Math.abs(minutes(row.time) - minutes(time)) < APPOINTMENT_MINUTES)) {
        return { time, status: 'booked' };
      }
      const closed = taken.some((row) => row.closed && row.time === time);
      return { time, status: closed ? 'closed' : 'open' };
    });
    if (slots.length) days.push({ date, slots });
  }
  return days;
}

export async function availableDays(db, now, last) {
  const today = ymd(now);
  const time = hm(now);
  return (await readSchedule(db, today, last)).map(({ date, slots }) => ({
    date,
    times: slots.filter((slot) => slot.status === 'open' && (date > today || slot.time > time)).map((slot) => slot.time),
  })).filter(({ times }) => times.length);
}

export async function freeSlots(db, day) {
  if (!isValidYmd(day)) return [];
  const now = nowLocal();
  const times = scheduledTimes(day).filter((time) => isBookableSlot(day, time, now));
  if (!times.length) return [];
  const [result] = await readSchedule(db, day, day);
  return result.slots.filter(({ time, status }) => status === 'open' && times.includes(time)).map(({ time }) => time);
}
