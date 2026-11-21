// Тесты чистой логики (без SDK) — запуск: node test/pure_test.mjs
import assert from 'node:assert/strict';

import { WORK_SLOTS, pad2 } from '../src/lib/config.js';
import {
  shiftYmd, daysInMonth, weekdayIndex, fmtDmyWd, monthTitle, clampYm, isValidYmd,
} from '../src/lib/dates.js';
import {
  mainMenuKb, clientCalendarKb, adminCalendarKb, slotsKb, confirmKb,
  myBookingsKb, cancelConfirmKb, adminDayKb, bookingDetailKb,
  adminCancelConfirmKb, clientsKb, clientDetailKb, blockedKb, nearestKb, phoneKb, phoneBookingKb, bookingDoneKb,
  monthNoticeKb, nextMonthKb, nextDayKb,
} from '../src/lib/keyboards.js';
import { isReminderDue, whenWord, clientText } from '../src/lib/reminderLogic.js';

let passed = 0;
function ok(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`  ok: ${name}`);
}
const flat = (markup) => markup.inline_keyboard.flat();

// ---------- слоты ----------

assert.deepEqual(WORK_SLOTS, {
  2: ['12:00', '14:30', '17:00'],
  4: ['12:00', '14:30', '17:00'],
  6: ['10:30', '13:00', '15:30'],
});

// ---------- даты ----------

ok('shiftYmd -1', shiftYmd('2026-10-12', -1) === '2026-10-11');
ok('shiftYmd через месяц', shiftYmd('2026-10-31', 1) === '2026-11-01');
ok('дней в октябре 31', daysInMonth(2026, 10) === 31);
ok('дней в феврале 2026 = 28', daysInMonth(2026, 2) === 28);
ok('1 октября 2026 — четверг (индекс 3)', weekdayIndex('2026-10-01') === 3);
ok('12 октября 2026 — понедельник (индекс 0)', weekdayIndex('2026-10-12') === 0);
ok('формат даты с днём недели', fmtDmyWd('2026-10-12') === '12.10.2026, пн');
ok('название месяца', monthTitle(202610) === 'Октябрь 2026');
ok('clampYm', clampYm(202699, 202610, 202612) === 202612);
ok('валидация даты', isValidYmd('2026-10-12') && !isValidYmd('2026-02-30') && !isValidYmd('бред'));
ok('pad2', pad2(5) === '05' && pad2(45) === '45');

// ---------- клавиатура клиента ----------

{
  const free = ['2026-10-14', '2026-10-16'];
  const kb = clientCalendarKb(202610, free);
  const all = flat(kb);
  ok('заголовок месяца', all.some((b) => b.text === 'Октябрь 2026'));
  ok('клиенту доступен только текущий месяц', all.every((b) => !b.callback_data.startsWith('ccal:')));
  const cday = all.filter((b) => b.callback_data?.startsWith('cday:'));
  ok('доступные дни показываются с названием дня недели',
    cday.length === 2 && cday.some((b) => b.callback_data === 'cday:2026-10-14' && b.text === 'Среда, 14.10')
    && cday.some((b) => b.callback_data === 'cday:2026-10-16' && b.text === 'Пятница, 16.10'));
  ok('из календаря есть выход в меню', all.some((b) => b.callback_data === 'menu:main'));
}

// ---------- клавиатура владельца ----------

{
  const kb = adminCalendarKb(2026, 10, 202608, 202612, { '2026-10-15': 3 });
  const all = flat(kb);
  ok('день с записями помечен', all.some((b) => b.text === '15 ·3' && b.callback_data === 'aday:2026-10-15'));
  ok('в прошлое листать можно', all.some((b) => b.callback_data === 'acal:202609'));
  ok('нижние кнопки панели', all.some((b) => b.callback_data === 'nearest')
    && all.some((b) => b.callback_data === 'acl:0')
    && all.some((b) => b.callback_data === 'blocked'));
}

// ---------- прочие клавиатуры ----------

ok('главное меню с админкой', flat(mainMenuKb(true)).some((b) => b.callback_data === 'menu:admin'));
ok('главное меню без админки', flat(mainMenuKb(false)).every((b) => b.callback_data !== 'menu:admin'));
ok('слоты по ≤3 в ряд + назад', (() => {
  const kb = slotsKb('2026-10-12', WORK_SLOTS[2]);
  const dataRows = kb.inline_keyboard.slice(0, -1);
  return dataRows.every((r) => r.length <= 3 && r.every((b) => b.callback_data.startsWith('cslot:2026-10-12|')))
    && dataRows.flat().length === WORK_SLOTS[2].length
    && kb.inline_keyboard.at(-1)[0].callback_data === 'ccal:202610';
})());
ok('подтверждение записи', flat(confirmKb('2026-10-12', '14:30'))
  .some((b) => b.callback_data === 'ccf:2026-10-12|14:30'));
ok('мои записи с отменой', (() => {
  const kb = myBookingsKb([{ id: 7, date: '2026-10-12', time: '10:00' }]);
  return flat(kb).some((b) => b.callback_data === 'cancelq:7' && b.text === '❌ 12.10.2026 10:00');
})());
ok('подтверждение отмены', flat(cancelConfirmKb(7)).some((b) => b.callback_data === 'cancel2:7'));
ok('день владельца: кнопки записей', (() => {
  const kb = adminDayKb('2026-10-12', [{ id: 5, time: '10:00', user_name: 'Анна' }]);
  return flat(kb).some((b) => b.callback_data === 'abk:5' && b.text.includes('Анна'));
})());
ok('карточка записи: блок и назад', (() => {
  const all = flat(bookingDetailKb(5, 42, false, '2026-10-12'));
  return all.some((b) => b.callback_data === 'aupd:5')
    && all.some((b) => b.callback_data === 'blk:42:bk:5')
    && all.some((b) => b.callback_data === 'aday:2026-10-12');
})());
ok('кнопка блокировки меняет подпись', flat(bookingDetailKb(5, 42, true, '2026-10-12'))
  .some((b) => b.text === '✅ Разблокировать клиента'));
ok('подтверждение отмены владельцем', flat(adminCancelConfirmKb(5))
  .some((b) => b.callback_data === 'aup2:5'));
ok('список клиентов', (() => {
  const kb = clientsKb(
    [{ tg_id: 42, name: 'Анна', active_bookings: 2 }],
    1, 3, new Set([42]),
  );
  const all = flat(kb);
  return all.some((b) => b.callback_data === 'aclu:42' && b.text.includes('🚫') && b.text.includes('2'))
    && all.some((b) => b.callback_data === 'acl:0' && b.text === '◀️')
    && all.some((b) => b.callback_data === 'acl:2' && b.text === '▶️')
    && all.some((b) => b.text === '2/3');
})());
ok('карточка клиента', flat(clientDetailKb(42, false)).some((b) => b.callback_data === 'blk:42:cd:42'));
ok('список заблокированных', flat(blockedKb([{ tg_id: 42, name: 'Анна' }]))
  .some((b) => b.callback_data === 'blk:42:bl'));
ok('ближайшие записи', flat(nearestKb([{ id: 3, date: '2026-10-12', time: '12:00', user_name: 'Боб' }], '30', 0, false))
  .some((b) => b.callback_data === 'abk:3'));
ok('клавиатура Telegram запрашивает контакт', phoneKb().keyboard.flat().some((b) => b.request_contact));

// ---------- согласованность callback-данных с роутером ----------

{
  const known = /^(noop|menu:(main|book|mine|phone|admin)|phone:cancel|ccal:\d{6}|cday:\d{4}-\d{2}-\d{2}|cslot:[\d-]+\|[\d:]+|ccf:[\d-]+\|[\d:]+|ccn|cancelq:\d+|cancel2:\d+|acal:\d{6}|aday:\d{4}-\d{2}-\d{2}|abk:\d+|aupd:\d+|aup2:\d+|blk:\d+:[a-z:0-9]+|acl:\d+|aclu:\d+|nearest(?::(7|30|all):\d+)?|blocked|freewindows|nextmonth(?::\d{6})?|nextday:[\d-]+|nextslot:[\d-]+\|[\d:]+\|[01])$/;
  const nextDay = { date: '2026-11-04', slots: [
    { time: '12:00', selected: true, booked: false },
    { time: '14:30', selected: false, booked: false },
  ] };
  const kbs = [
    mainMenuKb(true), mainMenuKb(false), bookingDoneKb(), phoneBookingKb('2026-10-14'),
    clientCalendarKb(202610, ['2026-10-14']),
    adminCalendarKb(2026, 10, 202608, 202612, {}),
    slotsKb('2026-10-12', ['10:00', '10:45', '11:30', '12:15']),
    confirmKb('2026-10-12', '10:00'),
    myBookingsKb([{ id: 1, date: '2026-10-12', time: '10:00' }]),
    cancelConfirmKb(1),
    adminDayKb('2026-10-12', [{ id: 2, time: '10:00', user_name: 'X' }]),
    bookingDetailKb(2, 42, false, '2026-10-12'),
    adminCancelConfirmKb(2),
    clientsKb([{ tg_id: 42, name: null, active_bookings: 0 }], 0, 1, new Set()),
    clientDetailKb(42, true),
    blockedKb([{ tg_id: 42, name: 'A' }]),
    nearestKb([{ id: 3, date: '2026-10-12', time: '10:00', user_name: 'B' }], 'all', 1, true),
    monthNoticeKb(202611), nextMonthKb(202611, [nextDay]), nextDayKb(nextDay),
  ];
  for (const kb of kbs) {
    for (const b of flat(kb)) {
      assert.match(b.callback_data, known, `неизвестный callback: ${b.callback_data} (${b.text})`);
    }
  }
  ok('все callback-данные разбираются роутером', true);
}

// ---------- напоминания ----------

const at = (y, m, d, hh, mm) => new Date(Date.UTC(y, m - 1, d, hh, mm));
ok('пора напоминать (после 12:00 накануне)', isReminderDue('2026-10-12', at(2026, 10, 11, 12, 5)));
ok('рано напоминать (до 12:00 накануне)', !isReminderDue('2026-10-12', at(2026, 10, 11, 11, 59)));
ok('не пора напоминать (за два дня)', !isReminderDue('2026-10-13', at(2026, 10, 11, 12, 5)));
ok('пора напоминать (в день сеанса — догоняем)', isReminderDue('2026-10-12', at(2026, 10, 12, 8, 0)));
ok('слово «завтра»', whenWord('2026-10-12', '2026-10-11') === 'завтра');
ok('слово «сегодня»', whenWord('2026-10-12', '2026-10-12') === 'сегодня');
ok('иначе — дата с днём недели', whenWord('2026-10-12', '2026-10-10') === '12.10.2026, пн');
ok('текст клиенту', clientText('2026-10-12', '14:30', at(2026, 10, 11, 12, 0)).includes('завтра') && clientText('2026-10-12', '14:30', at(2026, 10, 11, 12, 0)).includes('14:30'));

console.log(`\nВсе проверки пройдены ✅ (${passed})`);
