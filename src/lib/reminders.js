import { nowLocal, ymd, hm, shiftYmd } from './dates.js';
import { isReminderDue, whenWord, clientText } from './reminderLogic.js';
import * as repo from './repo.js';
import { esc } from './ui.js';

const RETRY_DELAY = 15 * 60_000;

export async function sweepReminders(api, db, ownerIds, now = nowLocal(), timestamp = Date.now()) {
  const todayIso = ymd(now);
  const tomorrow = shiftYmd(todayIso, 1);
  const lastDay = isReminderDue(tomorrow, now) ? tomorrow : todayIso;
  const batchSize = Math.min(5, Math.max(1, Math.floor(12 / (ownerIds.length + 1))));
  const rows = await repo.getUnsentReminders(db, todayIso, hm(now), lastDay, timestamp, batchSize);
  let sent = 0;
  let failed = 0;

  for (const r of rows) {
    const until = timestamp + RETRY_DELAY;
    const claimed = await repo.claimReminder(db, r.id, timestamp, until);
    if (!claimed) continue;

    const recipients = new Map(ownerIds.map((id) => [id, ownerText(r, todayIso)]));
    recipients.set(r.tg_user_id, clientText(r.date, r.time, now));
    const sentChats = new Set(JSON.parse(claimed.reminder_chats));
    const pending = [...recipients].filter(([id]) => !sentChats.has(id));
    if (!pending.length) {
      await repo.saveReminderProgress(db, r.id, until, [...sentChats], true);
    }

    for (const [chatId, text] of pending) {
      try {
        await api.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML' });
      } catch {
        failed++;
        continue;
      }
      sent++;
      sentChats.add(chatId);
      const complete = [...recipients.keys()].every((id) => sentChats.has(id));
      if (!await repo.saveReminderProgress(db, r.id, until, [...sentChats], complete)) break;
    }
  }
  return { sent, failed };
}

function ownerText(r, todayIso) {
  const name = r.user_name || 'клиент';
  const phone = r.user_phone || 'нет телефона';
  const username = r.user_username ? `, @${r.user_username}` : '';
  return `⏰ <b>Запись на маникюр — ${whenWord(r.date, todayIso)} в ${r.time}</b>\n` +
    `${esc(name)} (${esc(phone)}${esc(username)})`;
}
