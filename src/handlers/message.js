import * as repo from '../lib/repo.js';
import { esc, sendMsg, notifyOwners } from '../lib/ui.js';
import { mainMenuKb } from '../lib/keyboards.js';
import { sendExport } from '../lib/export.js';

export default async function (message, { api, db, ownerIds }) {
  if (message.chat?.type !== 'private' || !message.from || !message.text) return;
  const text = message.text.trim();
  const from = message.from;
  const chatId = message.chat.id;
  const isOwner = ownerIds.includes(from.id);
  const user = await repo.getUser(db, from.id);
  if (user?.is_blocked && !isOwner) {
    await sendMsg(api, chatId, 'Вы заблокированы в этом боте.');
    return;
  }

  if (text === '/start' || text === '/start booking') {
    await handleStart(api, db, message, user, ownerIds);
    return;
  }

  if (text === '/export') {
    if (!isOwner) {
      await sendMsg(api, chatId, 'Команда доступна только владельцу.');
      return;
    }
    await sendMsg(api, chatId, '📤 Готовлю выгрузку записей…');
    try {
      await sendExport(api, db, chatId);
    } catch (e) {
      console.error('export failed:', e);
      await sendMsg(api, chatId, '⚠️ Не удалось сформировать выгрузку, попробуйте позже.');
    }
    return;
  }

  if (user && user.awaiting_phone) {
    await handlePhoneInput(api, db, chatId, from, text, isOwner);
    return;
  }

  await sendMsg(
    api,
    chatId,
    '👋 Это бот записи на маникюр. Отправьте /start, чтобы начать.',
  );
}

async function handleStart(api, db, message, existingUser, ownerIds) {
  const from = message.from;
  const chatId = message.chat.id;

  if (!existingUser) {
    await repo.upsertUser(db, from.id, from.username ?? null,
      [from.first_name, from.last_name].filter(Boolean).join(' ') || null);
    const uname = from.username ? ` (@${from.username})` : '';
    await notifyOwners(api, ownerIds, `🙋 Новый клиент: ${esc(from.first_name || '')}${uname}`);
  }

  await sendMsg(
    api,
    chatId,
    '💅 <b>Запись на маникюр</b>\n\n' +
    'Выберите день и время в разделе «📅 Записаться».\n' +
    'За день до визита придёт напоминание.',
    mainMenuKb(ownerIds.includes(from.id)),
  );
}

async function handlePhoneInput(api, db, chatId, from, text, isOwner) {
  const cleaned = text.replace(/[ \-()\t]/g, '');
  if (/^\+?\d{7,15}$/.test(cleaned)) {
    await repo.setPhone(db, from.id, cleaned);
    await repo.setAwaitingPhone(db, from.id, 0);
    await sendMsg(api, chatId, '📞 Телефон сохранён.', mainMenuKb(isOwner));
    return;
  }
  await sendMsg(
    api,
    chatId,
    'Не похоже на номер 🤔 Отправьте, пожалуйста, например: <b>+7 999 000-11-22</b>',
  );
}
