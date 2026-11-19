import handleMessage from './handlers/message.js';
import handleCallback from './handlers/callback_query.js';
import { parseOwnerIds } from './lib/config.js';
import { connectD1 } from './lib/d1.js';
import { sweepReminders } from './lib/reminders.js';
import { createTelegramApi } from './lib/telegram.js';

function services(env) {
  return {
    api: createTelegramApi(env.TELEGRAM_BOT_TOKEN),
    db: connectD1(env.DB),
    ownerIds: parseOwnerIds(env.TELEGRAM_OWNER_IDS),
  };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health' && request.method === 'GET') {
      return new Response('manicure-bot');
    }
    if (pathname !== '/telegram' || request.method !== 'POST') {
      return new Response(null, { status: 404 });
    }
    if (!env.TELEGRAM_WEBHOOK_SECRET
        || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response(null, { status: 403 });
    }

    try {
      const update = await request.json();
      if (update.message) await handleMessage(update.message, services(env));
      else if (update.callback_query) await handleCallback(update.callback_query, services(env));
      return new Response(null, { status: 204 });
    } catch {
      console.error('Telegram update could not be processed');
      return new Response(null, { status: 500 });
    }
  },

  async scheduled(_event, env) {
    const { api, db, ownerIds } = services(env);
    const { sent, failed } = await sweepReminders(api, db, ownerIds);
    if (failed) console.warn('Reminder deliveries will be retried', { sent, failed });
  },
};
