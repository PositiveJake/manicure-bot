import * as repo from '../lib/repo.js';
import { esc, sendMsg, notifyOwners } from '../lib/ui.js';
import { mainMenuKb, phoneKb, PHONE_HOME, REMOVE_PHONE_KEYBOARD } from '../lib/keyboards.js';
import { sendExport } from '../lib/export.js';
import { freeSlots, renderConfirm, renderSlots } from '../lib/views.js';

export default async function (message, { api, db, ownerIds }) {
  if (message.chat?.type !== 'private' || !message.from || (!message.text && !message.contact)) return;
  const text = message.text?.trim();
  const from = message.from;
  const chatId = message.chat.id;
  const isOwner = ownerIds.includes(from.id);
  const user = await repo.getUser(db, from.id);
  if (user?.is_blocked && !isOwner) {
    await sendMsg(api, chatId, 'Вы заблокированы в этом боте.');
    return;
  }

  if (text === '/start' || text === '/start booking' || text === PHONE_HOME) {
    if (user?.awaiting_phone && await repo.cancelPhoneRequest(db, from.id)) {
      await sendMsg(api, chatId, 'Запрос номера закрыт.', REMOVE_PHONE_KEYBOARD);
    }
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

  if (user?.awaiting_phone) {
    await handlePhoneInput(api, db, message, user, isOwner);
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

async function handlePhoneInput(api, db, message, user, isOwner) {
  const { contact, from, chat } = message;
  const digits = contact?.phone_number?.replace(/[+\s()-]/g, '');
  if (contact?.user_id !== from.id || message.forward_origin || !/^\d{7,15}$/.test(digits ?? '')) {
    await sendMsg(api, chat.id, 'Поделитесь номером своего аккаунта кнопкой «Поделиться номером».', phoneKb());
    return;
  }
  const phone = `+${digits}`;
  const pending = user.pending_phone_slot;
  if (!await repo.verifyPhone(db, from.id, pending, phone, isOwner)) return;
  await sendMsg(api, chat.id, '📞 Номер подтверждён.', REMOVE_PHONE_KEYBOARD);
  if (!pending) {
    await sendMsg(api, chat.id, 'Выберите действие.', mainMenuKb(isOwner));
    return;
  }
  const [dayIso, slot] = pending.split('|');
  const ctx = { db, editMsg: (text, markup) => sendMsg(api, chat.id, text, markup) };
  if ((await freeSlots(db, dayIso)).includes(slot)) {
    await renderConfirm(ctx, dayIso, slot, { ...user, phone });
  } else {
    await sendMsg(api, chat.id, 'Выбранное время уже недоступно. Выберите другое.');
    await renderSlots(ctx, null, null, dayIso, false);
  }
}
