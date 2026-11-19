// ===== Настройки салона — всё меняется здесь =====

// Индексы дней недели: понедельник = 0, воскресенье = 6.
export const WORK_SLOTS = {
  2: ['12:00', '14:30', '17:00'],
  4: ['12:00', '14:30', '17:00'],
  6: ['10:30', '13:00', '15:30'],
};
export const APPOINTMENT_MINUTES = 45;
export const BOOKING_MONTHS_AHEAD = 2;   // на сколько месяцев вперёд можно записываться
export const ADMIN_MONTHS_BACK = 2;      // глубина календаря владельца в прошлое

// Местное время салона: смещение от UTC в часах (Москва = 3, летнего времени нет)
export const TZ_OFFSET_HOURS = 3;

// Время, начиная с которого задание отправляет напоминания накануне сеанса.
export const REMINDER_HOUR = 12;
export const REMINDER_MINUTE = 0;

export function parseOwnerIds(value) {
  const ids = value?.split(',').map((id) => Number(id.trim()));
  if (!ids?.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('TELEGRAM_OWNER_IDS must contain Telegram user IDs');
  }
  return [...new Set(ids)];
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}
