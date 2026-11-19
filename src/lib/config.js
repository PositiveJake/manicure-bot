// ===== Настройки салона — всё меняется здесь =====

export const WORK_START = 10;            // час начала работы
export const WORK_END = 20;              // час, к которому должен закончиться последний сеанс
export const SLOT_MINUTES = 45;          // длина сеанса в минутах
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

export const TIME_SLOTS = (() => {
  const slots = [];
  for (let t = WORK_START * 60; t + SLOT_MINUTES <= WORK_END * 60; t += SLOT_MINUTES) {
    slots.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
  }
  return slots;
})();
