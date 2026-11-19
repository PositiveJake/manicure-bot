import { ymd, nowLocal } from './dates.js';
import * as repo from './repo.js';

// Выгрузка записей в CSV (Excel-совместимую): страховка и способ забрать
// данные с платформы в любое время.

function csvCell(v) {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function sendExport(api, db, chatId) {
  const rows = await repo.allBookingsForExport(db);
  const header = 'Дата;Время;Клиент;Username;Телефон;Telegram ID;Напоминание;Создана';
  const lines = rows.map((r) => [
    r.date, r.time, r.user_name || '', r.user_username || '', r.user_phone || '',
    r.tg_id, r.reminder_sent ? 'да' : 'нет', r.created_at || '',
  ].map(csvCell).join(';'));
  const csv = '\uFEFF' + header + '\n' + lines.join('\n');
  const filename = `bookings_${ymd(nowLocal())}.csv`;
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('document', new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  form.set('caption', rows.length
    ? `📤 Записей в базе: ${rows.length}`
    : '📤 Записей в базе пока нет');
  await api.sendDocument(form);
}
