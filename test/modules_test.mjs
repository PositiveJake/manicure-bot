// Проверка публичных для проекта функций и входов Worker.
import * as repo from '../src/lib/repo.js';
import * as ui from '../src/lib/ui.js';
import * as views from '../src/lib/views.js';
import * as reminders from '../src/lib/reminders.js';
import * as exp from '../src/lib/export.js';
import * as keyboards from '../src/lib/keyboards.js';
import handlerMessage from '../src/handlers/message.js';
import handlerCallback from '../src/handlers/callback_query.js';
import worker from '../src/worker.js';

let passed = 0;
const ok = (name, cond) => {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`  ok: ${name}`);
};

for (const name of [
  'getUser', 'upsertUser', 'requestPhone', 'cancelPhoneRequest', 'verifyPhone', 'setBlocked',
  'createBooking', 'getBooking', 'deleteBooking', 'getUserBookings',
  'getBookedTimesBetween', 'getDayCounts', 'getBookingsForDay',
  'getBookingsBetween', 'getUnsentReminders', 'claimReminder', 'saveReminderProgress',
  'listUsersPage', 'countUsers', 'listBlocked', 'allBookingsForExport',
]) {
  ok(`repo.${name}`, typeof repo[name] === 'function');
}

for (const name of ['esc', 'answerCb', 'editMsg', 'sendMsg', 'notifyOwners']) {
  ok(`ui.${name}`, typeof ui[name] === 'function');
}

for (const name of [
  'freeSlots', 'renderMainMenu', 'renderClientCalendar', 'renderSlots', 'renderConfirm',
  'renderMyBookings', 'renderCancelAsk', 'renderCancelDo', 'renderAdminCalendar',
  'renderDay', 'renderBookingDetail', 'renderAdminCancelAsk', 'renderAdminCancelDo',
  'renderClientsList', 'renderClientDetail', 'renderBlockedList', 'renderNearest',
]) {
  ok(`views.${name}`, typeof views[name] === 'function');
}

ok('reminders.sweepReminders', typeof reminders.sweepReminders === 'function');
ok('export.sendExport', typeof exp.sendExport === 'function');
ok('keyboards.CB — префиксы на месте', typeof keyboards.CB.CCAL === 'string' && keyboards.CB.CCAL === 'ccal');
ok('handlers/message — функция по умолчанию', typeof handlerMessage === 'function');
ok('handlers/callback_query — функция по умолчанию', typeof handlerCallback === 'function');
ok('worker.fetch', typeof worker.fetch === 'function');
ok('worker.scheduled', typeof worker.scheduled === 'function');

console.log(`\nГраф модулей корректен ✅ (${passed})`);
