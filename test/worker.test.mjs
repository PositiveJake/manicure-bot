import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from '../src/worker.js';
import { connectD1 } from '../src/lib/d1.js';
import { shiftYm, shiftYmd, todayIso } from '../src/lib/dates.js';
import { sweepReminders } from '../src/lib/reminders.js';
import { freeSlots, renderNearest } from '../src/lib/views.js';
import { createBooking } from '../src/lib/repo.js';

const schema = readFileSync(new URL('../migrations/0001_bookings.sql', import.meta.url), 'utf8');
const phoneMigration = readFileSync(new URL('../migrations/0002_verified_phone.sql', import.meta.url), 'utf8');
const client = 101;
const owner = 201;

function createDatabase(t, seed = '') {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  sqlite.exec(seed);
  sqlite.exec(phoneMigration);
  return {
    sqlite,
    binding: {
      prepare(text) {
        return {
          bind(...args) {
            const stmt = sqlite.prepare(text);
            return {
              async first() { return stmt.get(...args) ?? null; },
              async all() { return { results: stmt.all(...args) }; },
              async run() { return { meta: stmt.run(...args) }; },
            };
          },
        };
      },
    },
  };
}

test('owner and client are retried independently, with a single claim per booking', async (t) => {
  const { sqlite, binding } = createDatabase(t);
  const db = connectD1(binding);
  sqlite.exec(`
    INSERT INTO users (tg_id, name) VALUES (101, 'Клиент & мастер');
    INSERT INTO bookings (tg_user_id, date, time) VALUES
      (101, '2026-11-20', '10:00'), (101, '2026-11-19', '10:00');
    INSERT INTO bookings (tg_user_id, date, time, reminder_sent)
      VALUES (101, '2026-11-20', '12:00', 1);
  `);
  const sent = [];
  const api = {
    async sendMessage(message) {
      sent.push(message);
      if (message.chat_id === client && sent.length === 2) throw new Error('temporary');
    },
  };
  const before = new Date('2026-11-19T11:59:00Z');
  const due = new Date('2026-11-19T12:00:00Z');
  const timestamp = 1_000_000;
  await sweepReminders(api, db, [owner], before, timestamp);
  assert.deepEqual(sent, []);

  const results = await Promise.all([
    sweepReminders(api, db, [owner], due, timestamp),
    sweepReminders(api, db, [owner], due, timestamp),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.failed, 0), 1);
  assert.deepEqual(sent.map((message) => message.chat_id), [owner, client]);
  assert.match(sent[0].text, /Клиент &amp; мастер/);

  await sweepReminders(api, db, [owner], due, timestamp + 60_000);
  assert.equal(sent.length, 2);
  await sweepReminders(api, db, [owner], due, timestamp + 900_000);
  await sweepReminders(api, db, [owner], due, timestamp + 1_800_000);
  assert.deepEqual(sent.map((message) => message.chat_id), [owner, client, client]);
  assert.equal(sqlite.prepare('SELECT reminder_sent FROM bookings WHERE id = 1').get().reminder_sent, 1);
});

test('Telegram webhook covers booking, blocked buttons, owner cancellation and private chats', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-19T06:00:00Z') });
  const { sqlite, binding } = createDatabase(t, "INSERT INTO users (tg_id, phone) VALUES (101, '+70000000000')");
  const token = 'fake-token';
  const secret = 'fake-webhook-secret';
  const env = {
    DB: binding,
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_WEBHOOK_SECRET: secret,
    TELEGRAM_OWNER_IDS: String(owner),
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const method = new URL(url).pathname.split('/').at(-1);
    calls.push({ method, body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: true });
  });

  const chat = (id) => ({ id, type: 'private' });
  const from = (id) => ({ id, first_name: 'Test' });
  async function request(payload, header = secret) {
    return worker.fetch(new Request('https://manicure.example/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': header },
      body: JSON.stringify(payload),
    }), env);
  }
  const message = (id, text, target = chat(id)) => ({ message: { chat: target, from: from(id), text } });
  const button = (id, data) => ({
    callback_query: { id: 'test', from: from(id), data, message: { message_id: 1, chat: chat(id) } },
  });

  assert.equal((await request(message(client, '/start'), 'wrong')).status, 403);
  assert.equal((await request(message(owner, '/export', { id: -1, type: 'group' }))).status, 204);
  assert.deepEqual(calls, []);
  assert.equal((await request(message(client, '/start booking'))).status, 204);
  assert.ok(sqlite.prepare('SELECT 1 FROM users WHERE tg_id = ?').get(client));

  const friday = shiftYmd(todayIso(), 1);
  const sunday = shiftYmd(todayIso(), 3);
  const wednesday = shiftYmd(todayIso(), 6);
  const callbackKeys = () => calls.at(-1).body.reply_markup.inline_keyboard.flat();
  const contact = (id, userId, extra = {}) => ({
    message: { from: from(id), chat: chat(id), contact: { user_id: userId, phone_number: '79991234567' }, ...extra },
  });
  const count = () => sqlite.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
  const phoneState = () => sqlite.prepare('SELECT phone_verified, pending_phone_slot FROM users WHERE tg_id = ?').get(client);
  await request(button(client, 'menu:book'));
  assert.deepEqual(callbackKeys().filter((b) => b.callback_data.startsWith('cday:')).slice(0, 3).map((b) => b.text),
    ['Пятница, 20.11', 'Воскресенье, 22.11', 'Среда, 25.11']);
  assert.ok(callbackKeys().some((b) => b.callback_data === 'menu:main'));
  for (const [day, times] of [
    [friday, ['12:00', '14:30', '17:00']],
    [sunday, ['10:30', '13:00', '15:30']],
    [wednesday, ['12:00', '14:30', '17:00']],
  ]) {
    await request(button(client, `cday:${day}`));
    assert.deepEqual(callbackKeys().filter((b) => b.callback_data.startsWith('cslot:')).map((b) => b.text), times);
  }

  await request(button(client, `ccf:${friday}|12:00`)); // an existing confirmation button still requires verification
  assert.equal(count(), 0);
  assert.equal(phoneState().phone_verified, 0);
  assert.equal(calls.at(-1).body.reply_markup.keyboard[0][0].request_contact, true);
  await request(message(client, '+79998765432'));
  await request(contact(client, owner));
  await request(contact(client, client, { forward_origin: { type: 'user' } }));
  assert.equal(phoneState().phone_verified, 0);

  await request(button(client, `cday:${friday}`));
  assert.equal(phoneState().pending_phone_slot, null);
  assert.ok(calls.some(({ body }) => body.reply_markup?.remove_keyboard));
  await request(contact(client, client));
  assert.equal(phoneState().phone_verified, 0);

  await request(button(client, `cslot:${friday}|12:00`));
  await request(contact(client, client));
  assert.equal(phoneState().phone_verified, 1);
  assert.equal(count(), 0);
  assert.ok(callbackKeys().some((b) => b.callback_data === `ccf:${friday}|12:00`));
  await request(button(client, `ccf:${friday}|12:00`));
  assert.ok(callbackKeys().some((b) => b.callback_data === 'menu:main'));
  assert.ok(calls.some(({ body }) => body.chat_id === owner && /\+79991234567/.test(body.text)));
  await request(button(client, `ccf:${friday}|12:00`));
  await request(button(client, `ccf:${sunday}|12:00`));
  await request(button(client, `ccf:${shiftYmd(sunday, -1)}|12:00`));
  assert.equal(count(), 1);

  await request(button(client, 'aup2:1'));
  assert.equal(count(), 1);
  assert.match(calls.at(-1).body.text, /только владельцу/);
  await request(button(owner, 'aup2:1'));
  assert.equal(count(), 0);
  assert.ok(calls.some(({ body }) => body.chat_id === client && /отменена мастером/.test(body.text)));

  await request(button(owner, `blk:${client}:cl`));
  assert.equal(sqlite.prepare('SELECT is_blocked FROM users WHERE tg_id = ?').get(client).is_blocked, 1);
  await request(button(client, `ccf:${friday}|14:30`));
  assert.equal(count(), 0);
  assert.match(calls.at(-1).body.text, /заблокированы/);
});

test('owner can page through the next 30 days, including the last day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-19T09:00:00Z') });
  const { sqlite, binding } = createDatabase(t, 'INSERT INTO users (tg_id) VALUES (101)');
  const today = todayIso();
  const insert = sqlite.prepare('INSERT INTO bookings (tg_user_id, date, time) VALUES (101, ?, ?)');
  insert.run(today, '10:00');
  for (const offset of [1, 2, 3, 4, 5, 6, 8, 20, 29, 30]) insert.run(shiftYmd(today, offset), '17:00');
  const screens = [];
  const ctx = { db: connectD1(binding), editMsg: (text, markup) => screens.push({ text, markup }) };
  await renderNearest(ctx);
  await renderNearest(ctx, 1);
  assert.ok(screens[0].markup.inline_keyboard.flat().some((b) => b.callback_data === 'nearest:1'));
  assert.doesNotMatch(screens[0].text, /19\.11\.2026/);
  assert.match(screens[1].text, /18\.12\.2026/);
  assert.doesNotMatch(screens[1].text, /19\.12\.2026/);
});

test('new slots do not overlap a booking made with the old schedule', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-19T06:00:00Z') });
  const { sqlite, binding } = createDatabase(t, "INSERT INTO users (tg_id, phone) VALUES (101, '+79991234567')");
  const db = connectD1(binding);
  sqlite.exec("UPDATE users SET phone_verified = 1; INSERT INTO bookings (tg_user_id, date, time) VALUES (101, '2026-11-20', '11:30')");
  assert.deepEqual(await freeSlots(db, '2026-11-20'), ['14:30', '17:00']);
  assert.equal(await createBooking(db, client, '2026-11-20', '12:00'), false);
  assert.equal(await createBooking(db, client, '2026-11-20', '14:30'), true);
});

test('calendar navigation crosses the year boundary', () => {
  assert.equal(shiftYm(202611, 2), 202701);
  assert.equal(shiftYm(202701, -2), 202611);
});
