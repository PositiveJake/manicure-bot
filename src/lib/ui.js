import { BotApiError } from './telegram.js';

export function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export async function answerCb(api, callbackQueryId, text = '', showAlert = false) {
  try {
    await api.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      text: text || undefined,
      show_alert: showAlert,
    });
  } catch {
    // повторный answer — не ошибка
  }
}

export async function editMsg(api, chatId, messageId, text, markup) {
  try {
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: markup,
    });
  } catch (e) {
    const desc = e instanceof BotApiError ? e.description || '' : '';
    if (/message is not modified/i.test(desc)) return;
    // сообщение могло быть удалено — отправим новое
    try {
      await api.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: markup });
    } catch (e2) {
      console.warn('editMsg fallback failed:', e2?.description || e2);
    }
  }
}

export async function sendMsg(api, chatId, text, markup) {
  try {
    await api.sendMessage({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: markup });
  } catch (e) {
    console.warn('sendMsg failed:', e?.description || e);
  }
}

export async function notifyOwners(api, ownerIds, text) {
  for (const ownerId of ownerIds) {
    try {
      await api.sendMessage({ chat_id: ownerId, text, parse_mode: 'HTML' });
    } catch (e) {
      console.warn('Owner notification failed:', e?.code);
    }
  }
}
