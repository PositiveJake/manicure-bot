import { WORK_SLOTS } from './config.js';
import { weekdayIndex } from './dates.js';

export function defaultTimes(day) {
  return WORK_SLOTS[weekdayIndex(day)] ?? [];
}
