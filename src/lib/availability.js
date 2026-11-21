import { APPOINTMENT_MINUTES, SELECTABLE_TIMES } from './config.js';
import { hm, isValidYmd, nowLocal, shiftYmd, ymd, ymOfYmd } from './dates.js';
import { getSlotOccupancy } from './repo.js';
import { defaultTimes } from './slotRules.js';

function isBookableDay(day, today) {
  return isValidYmd(day) && day >= today && ymOfYmd(day) === ymOfYmd(today);
}

export function isBookableSlot(day, slot, now = nowLocal()) {
  const today = ymd(now);
  return isBookableDay(day, today) && SELECTABLE_TIMES.includes(slot) && (day > today || slot > hm(now));
}

function minutes(time) {
  const [hours, minute] = time.split(':').map(Number);
  return hours * 60 + minute;
}

export async function readSchedule(db, first, last, { editable = false } = {}) {
  const byDay = new Map();
  for (const row of await getSlotOccupancy(db, first, last)) {
    if (!byDay.has(row.date)) byDay.set(row.date, []);
    byDay.get(row.date).push(row);
  }

  const days = [];
  for (let date = first; date <= last; date = shiftYmd(date, 1)) {
    const bookedMinutes = [];
    const legacyClosed = new Set();
    const overrides = new Map();
    for (const row of byDay.get(date) ?? []) {
      if (row.kind === 'booking') bookedMinutes.push(minutes(row.time));
      if (row.kind === 'legacy') legacyClosed.add(row.time);
      if (row.kind === 'selection') overrides.set(row.time, row.selected === 1);
    }
    const defaults = defaultTimes(date);
    const slots = [];
    for (const time of SELECTABLE_TIMES) {
      const selected = overrides.get(time) ?? (defaults.includes(time) && !legacyClosed.has(time));
      if (!editable && !selected) continue;
      const start = minutes(time);
      const booked = bookedMinutes.some((bookedStart) => Math.abs(bookedStart - start) < APPOINTMENT_MINUTES);
      slots.push({ time, selected, booked });
    }
    if (slots.length) days.push({ date, slots });
  }
  return days;
}

export async function availableDays(db, now, last) {
  const today = ymd(now);
  const time = hm(now);
  return (await readSchedule(db, today, last)).map(({ date, slots }) => ({
    date,
    times: slots.filter((slot) => !slot.booked && (date > today || slot.time > time)).map((slot) => slot.time),
  })).filter(({ times }) => times.length);
}

export async function freeSlots(db, day) {
  const now = nowLocal();
  const today = ymd(now);
  if (!isBookableDay(day, today)) return [];
  const [result] = await readSchedule(db, day, day);
  return (result?.slots ?? []).filter(({ time, booked }) => !booked && (day > today || time > hm(now)))
    .map(({ time }) => time);
}
