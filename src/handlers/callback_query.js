import { currentYm, fmtDmyWd } from '../lib/dates.js';
import { answerCb, editMsg, notifyOwners, esc } from '../lib/ui.js';
import { CB } from '../lib/keyboards.js';
import * as repo from '../lib/repo.js';
import * as views from '../lib/views.js';

export default async function (cq, { api, db, ownerIds }) {
  const data = cq.data || '';
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;

  if (!chatId || !messageId || cq.message.chat.type !== 'private') {
    await answerCb(api, cq.id);
    return;
  }

  const viewCtx = {
    api,
    db,
    cq,
    userId: cq.from.id,
    isOwner: ownerIds.includes(cq.from.id),
    fromName: [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') || 'клиент',
    answerCb: (t, a) => answerCb(api, cq.id, t, a),
    editMsg: (text, markup) => editMsg(api, chatId, messageId, text, markup),
    notifyOwners: (text) => notifyOwners(api, ownerIds, text),
  };

  try {
    if (!viewCtx.isOwner && (await repo.getUser(db, cq.from.id))?.is_blocked) {
      await answerCb(api, cq.id, 'Вы заблокированы в этом боте.', true);
      return;
    }
    await route(viewCtx, data);
  } catch (e) {
    console.error('callback handler failed:', e, 'data:', data);
    await answerCb(api, cq.id, '⚠️ Произошла ошибка, попробуйте ещё раз.', true);
  }
}

async function route(ctx, data) {
  const { db, userId, isOwner: own } = ctx;

  const after = (prefix) => (data.startsWith(prefix + ':') ? data.slice(prefix.length + 1) : null);

  // ---------- общие разделы ----------

  if (data === CB.NOOP) return;

  if (data === CB.MAIN) {
    const cq = ctx.cq;
    await repo.upsertUser(db, userId, cq?.from?.username ?? null, ctx.fromName || null);
    await ctx.answerCb();
    await views.renderMainMenu(ctx);
    return;
  }

  if (data === CB.BOOK) {
    await ctx.answerCb();
    await views.renderClientCalendar(ctx, null, null, currentYm());
    return;
  }

  if (data === CB.MINE) {
    await ctx.answerCb();
    await views.renderMyBookings(ctx, null, null);
    return;
  }

  {
    const payload = after(CB.CCAL);
    if (payload !== null) {
      await ctx.answerCb();
      await views.renderClientCalendar(ctx, null, null, parseIntOr(payload, currentYm()));
      return;
    }
  }

  {
    const payload = after(CB.CDAY);
    if (payload !== null) {
      await ctx.answerCb();
      await views.renderSlots(ctx, null, null, payload, true);
      return;
    }
  }

  {
    const payload = after(CB.CSLOT);
    if (payload !== null) {
      const [dayIso, slot] = payload.split('|');
      await ctx.answerCb();
      await views.renderConfirm(ctx, null, null, dayIso, slot);
      return;
    }
  }

  {
    const payload = after(CB.CCF);
    if (payload !== null) {
      const [dayIso, slot] = payload.split('|');
      if (!views.isBookableSlot(dayIso, slot)) {
        await ctx.answerCb('Это время уже недоступно. Выберите другое.', true);
        await views.renderClientCalendar(ctx, null, null, currentYm());
        return;
      }
      const ok = await repo.createBooking(db, userId, dayIso, slot, own);
      if (!ok) {
        await ctx.answerCb('Увы, это время только что заняли. Выберите другое.', true);
        await views.renderSlots(ctx, null, null, dayIso, false);
        return;
      }
      await ctx.answerCb('Вы записаны! ✨');
      const user = await repo.getUser(db, userId);
      const name = (user && user.name) || ctx.fromName;
      const phone = user ? user.phone : '';
      const uname = ctx.cq?.from?.username ? `, @${ctx.cq.from.username}` : '';
      const phoneS = phone ? `\n📞 ${esc(phone)}` : '';
      await ctx.notifyOwners(
        `🆕 <b>Новая запись</b>\n👤 ${esc(name)}${uname}${phoneS}\n📅 ${fmtDate(dayIso)} — ${slot}`,
      );
      await ctx.editMsg(
        '✨ <b>Вы записаны!</b>\n\n' +
        `📅 ${fmtDate(dayIso)} — <b>${slot}</b>\n\n` +
        'За день до сеанса придёт напоминание.\n' +
        'Отменить запись можно в «📋 Мои записи».',
        null,
      );
      return;
    }
  }

  if (data === CB.CCN) {
    await ctx.answerCb();
    await views.renderClientCalendar(ctx, null, null, currentYm());
    return;
  }

  {
    const payload = after(CB.CANCELQ);
    if (payload !== null) {
      await views.renderCancelAsk(ctx, null, null, parseIntOr(payload, 0));
      return;
    }
  }

  {
    const payload = after(CB.CANCEL2);
    if (payload !== null) {
      await views.renderCancelDo(ctx, null, null, parseIntOr(payload, 0));
      return;
    }
  }

  // ---------- телефон ----------

  if (data === CB.PHONE) {
    await ctx.answerCb();
    await repo.setAwaitingPhone(db, userId, 1);
    await ctx.editMsg(
      '📞 Отправьте номер телефона одним сообщением,\nнапример: <b>+7 999 000-11-22</b>',
      { inline_keyboard: [[{ text: '❌ Не указывать', callback_data: CB.PHONE_CANCEL }]] },
    );
    return;
  }

  if (data === CB.PHONE_CANCEL) {
    await repo.setAwaitingPhone(db, userId, 0);
    await ctx.answerCb();
    await views.renderMainMenu(ctx);
    return;
  }

  // ---------- владелец ----------

  if (data === CB.ADMIN) {
    if (!own) return denyOwner(ctx);
    await ctx.answerCb();
    await views.renderAdminCalendar(ctx, null, null, currentYm());
    return;
  }

  {
    const payload = after(CB.ACAL);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      await ctx.answerCb();
      await views.renderAdminCalendar(ctx, null, null, parseIntOr(payload, currentYm()));
      return;
    }
  }

  if (data === CB.NEAREST) {
    if (!own) return denyOwner(ctx);
    await ctx.answerCb();
    await views.renderNearest(ctx, null, null);
    return;
  }

  {
    const payload = after(CB.ADAY);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      await ctx.answerCb();
      await views.renderDay(ctx, null, null, payload);
      return;
    }
  }

  {
    const payload = after(CB.ABK);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      await ctx.answerCb();
      await views.renderBookingDetail(ctx, null, null, parseIntOr(payload, 0));
      return;
    }
  }

  {
    const payload = after(CB.AUPD);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      await views.renderAdminCancelAsk(ctx, null, null, parseIntOr(payload, 0));
      return;
    }
  }

  {
    const payload = after(CB.AUP2);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      await views.renderAdminCancelDo(ctx, null, null, parseIntOr(payload, 0));
      return;
    }
  }

  {
    const payload = after(CB.ACLU);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      await ctx.answerCb();
      await views.renderClientDetail(ctx, null, null, parseIntOr(payload, 0));
      return;
    }
  }

  {
    const payload = after(CB.ACL);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      await ctx.answerCb();
      await views.renderClientsList(ctx, null, null, parseIntOr(payload, 0));
      return;
    }
  }

  if (data === CB.BLOCKED) {
    if (!own) return denyOwner(ctx);
    await ctx.answerCb();
    await views.renderBlockedList(ctx, null, null);
    return;
  }

  {
    const payload = after(CB.BLK);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      const sep = payload.indexOf(':');
      const uid = parseIntOr(sep === -1 ? payload : payload.slice(0, sep), 0);
      const ret = sep === -1 ? 'cl' : payload.slice(sep + 1);
      const u = await repo.getUser(db, uid);
      if (!u) {
        await ctx.answerCb('Клиент не найден.', true);
        return;
      }
      const newState = u.is_blocked ? 0 : 1;
      await repo.setBlocked(db, uid, newState);
      await ctx.answerCb(`${newState ? 'Заблокирован' : 'Разблокирован'}: ${u.name || uid}`);
      if (ret === 'bl') await views.renderBlockedList(ctx, null, null);
      else if (ret.startsWith('cd:')) await views.renderClientDetail(ctx, null, null, parseIntOr(ret.slice(3), 0));
      else if (ret.startsWith('bk:')) await views.renderBookingDetail(ctx, null, null, parseIntOr(ret.slice(3), 0));
      else await views.renderClientsList(ctx, null, null, 0);
      return;
    }
  }

  // неизвестная кнопка — просто закрываем
  await ctx.answerCb();
}

async function denyOwner(ctx) {
  await ctx.answerCb('Раздел доступен только владельцу.', true);
}

function parseIntOr(s, fallback) {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function fmtDate(dayIso) {
  return fmtDmyWd(dayIso);
}
