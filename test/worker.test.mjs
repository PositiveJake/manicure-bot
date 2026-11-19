import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from '../src/worker.js';
import { connectD1 } from '../src/lib/d1.js';
import { shiftYm, shiftYmd, todayIso } from '../src/lib/dates.js';
import { sweepReminders } from '../src/lib/reminders.js';

const schema = readFileSync(new URL('../migrations/0001_bookings.sql', import.meta.url), 'utf8');
const client = 101;
const owner = 201;

function createDatabase(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(schema);
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
  const { sqlite, binding } = createDatabase(t);
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

  const tomorrow = shiftYmd(todayIso(), 1);
  const count = () => sqlite.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
  await request(button(client, `ccf:${tomorrow}|10:00`));
  await request(button(client, `ccf:${tomorrow}|10:00`));
  await request(button(client, `ccf:${shiftYmd(tomorrow, -2)}|10:00`));
  assert.equal(count(), 1);

  await request(button(client, 'aup2:1'));
  assert.equal(count(), 1);
  assert.match(calls.at(-1).body.text, /только владельцу/);
  await request(button(owner, 'aup2:1'));
  assert.equal(count(), 0);
  assert.ok(calls.some(({ body }) => body.chat_id === client && /отменена мастером/.test(body.text)));

  await request(button(owner, `blk:${client}:cl`));
  assert.equal(sqlite.prepare('SELECT is_blocked FROM users WHERE tg_id = ?').get(client).is_blocked, 1);
  await request(button(client, `ccf:${tomorrow}|11:30`));
  assert.equal(count(), 0);
  assert.match(calls.at(-1).body.text, /заблокированы/);
});

test('calendar navigation crosses the year boundary', () => {
  assert.equal(shiftYm(202611, 2), 202701);
  assert.equal(shiftYm(202701, -2), 202611);
});
