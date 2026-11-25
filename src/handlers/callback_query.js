import { currentYm, fmtDmyWd, isValidYmd, shiftYm, ymOfYmd } from '../lib/dates.js';
import { SELECTABLE_TIMES } from '../lib/config.js';
import { answerCb, editMsg, notifyOwners, esc, sendMsg } from '../lib/ui.js';
import { CB, backKb, bookingDoneKb, phoneBookingKb, phoneKb, REMOVE_PHONE_KEYBOARD } from '../lib/keyboards.js';
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
    sendMsg: (text, markup) => sendMsg(api, chatId, text, markup),
    notifyOwners: (text) => notifyOwners(api, ownerIds, text),
  };

  try {
    if (data === CB.NOOP) return await answerCb(api, cq.id);
    viewCtx.user = await repo.getUser(db, cq.from.id);
    if (!viewCtx.isOwner && viewCtx.user?.is_blocked) {
      await answerCb(api, cq.id, 'Вы заблокированы в этом боте.', true);
      return;
    }
    if (viewCtx.user?.awaiting_phone && await repo.cancelPhoneRequest(db, cq.from.id)) {
      await viewCtx.sendMsg('Запрос номера закрыт.', REMOVE_PHONE_KEYBOARD);
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

  if (data === CB.MAIN) {
    const cq = ctx.cq;
    await repo.upsertUser(db, userId, cq?.from?.username ?? null, ctx.fromName || null);
    await ctx.answerCb();
    await views.renderMainMenu(ctx);
    return;
  }

  if (data === CB.BOOK || data === CB.CCN || after(CB.CCAL) !== null) {
    await ctx.answerCb();
    await views.renderClientCalendar(ctx, parseIntOr(after(CB.CCAL), undefined));
    return;
  }

  if (data === CB.MINE) {
    await ctx.answerCb();
    await views.renderMyBookings(ctx, null, null);
    return;
  }

  {
    const payload = after(CB.CDAY);
    if (payload !== null) {
      await views.renderSlots(ctx, null, null, payload, true);
      return;
    }
  }

  {
    const payload = after(CB.CSLOT);
    if (payload !== null) {
      const [dayIso, slot] = payload.split('|');
      await openConfirmation(ctx, dayIso, slot);
      return;
    }
  }

  {
    const payload = after(CB.CCF);
    if (payload !== null) {
      const [dayIso, slot] = payload.split('|');
      if (!views.isBookableSlot(dayIso, slot)) {
        await ctx.answerCb('Это время уже недоступно. Выберите другое.', true);
        await views.renderClientCalendar(ctx, isValidYmd(dayIso) ? ymOfYmd(dayIso) : undefined);
        return;
      }
      if (!ctx.user?.phone_verified || !ctx.user.phone) {
        await openConfirmation(ctx, dayIso, slot);
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
        bookingDoneKb(),
      );
      return;
    }
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
    await beginPhoneRequest(ctx);
    return;
  }

  if (data === CB.PHONE_CANCEL) {
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

  if (data === CB.NEAREST || after(CB.NEAREST) !== null) {
    if (!own) return denyOwner(ctx);
    const [key, pageArg] = (after(CB.NEAREST) ?? '').split(':');
    const hasFilter = pageArg !== undefined && ['7', '30', 'all'].includes(key);
    const range = hasFilter ? key : '30';
    const page = Math.max(0, parseIntOr(hasFilter ? pageArg : key, 0));
    await ctx.answerCb();
    await views.renderNearest(ctx, range, page);
    return;
  }

  if (data === CB.FREE || after(CB.FREE) !== null) {
    if (!own) return denyOwner(ctx);
    await ctx.answerCb();
    await views.renderFreeWindows(ctx, parseIntOr(after(CB.FREE), 0));
    return;
  }

  if (data === CB.NEXT_MONTH || after(CB.NEXT_MONTH) !== null) {
    if (!own) return denyOwner(ctx);
    const month = shiftYm(currentYm(), 1);
    const target = after(CB.NEXT_MONTH);
    if (target !== null && target !== String(month)) {
      await ctx.answerCb('Срок настройки этого месяца закончился.', true);
      return;
    }
    await ctx.answerCb();
    await views.renderNextMonth(ctx, month);
    return;
  }

  {
    const day = after(CB.NEXT_DAY);
    if (day !== null) {
      if (!own) return denyOwner(ctx);
      await ctx.answerCb();
      await views.renderNextDay(ctx, day, shiftYm(currentYm(), 1));
      return;
    }
  }

  {
    const payload = after(CB.NEXT_SLOT);
    if (payload !== null) {
      if (!own) return denyOwner(ctx);
      const [day, time, state] = payload.split('|');
      const month = shiftYm(currentYm(), 1);
      if (!isValidYmd(day) || ymOfYmd(day) !== month || !SELECTABLE_TIMES.includes(time)
        || (state !== '0' && state !== '1')) {
        await ctx.answerCb('Это окно уже нельзя изменить здесь.', true);
        return;
      }
      const selected = state === '0';
      const updated = await repo.setSlotSelected(db, day, time, selected);
      await ctx.answerCb(updated ? (selected ? 'Окно выбрано.' : 'Окно снято.') : 'Это время занято.');
      await views.renderNextDay(ctx, day, month);
      return;
    }
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

async function openConfirmation(ctx, dayIso, slot) {
  if (!(await views.freeSlots(ctx.db, dayIso)).includes(slot)) {
    await ctx.answerCb('Это время уже недоступно. Выберите другое.', true);
    await views.renderSlots(ctx, null, null, dayIso, false);
    return;
  }
  await ctx.answerCb();
  if (ctx.user?.phone_verified && ctx.user.phone) {
    await views.renderConfirm(ctx, dayIso, slot, ctx.user);
    return;
  }
  await beginPhoneRequest(ctx, dayIso, slot);
}

async function beginPhoneRequest(ctx, dayIso, slot) {
  if (!ctx.user) {
    await repo.upsertUser(ctx.db, ctx.userId, ctx.cq.from.username ?? null, ctx.fromName);
  }
  await repo.requestPhone(ctx.db, ctx.userId, dayIso ? `${dayIso}|${slot}` : null);
  await ctx.editMsg(dayIso
    ? `📅 ${fmtDate(dayIso)} — <b>${slot}</b>\nПодтвердите номер, чтобы продолжить.`
    : '📞 Подтвердите номер вашего аккаунта Telegram.',
  dayIso ? phoneBookingKb(dayIso) : backKb('🏠 В главное меню', CB.MAIN));
  await ctx.sendMsg('Нажмите «Поделиться номером» под полем ввода. Номер будет доступен мастеру.', phoneKb());
}

async function denyOwner(ctx) {
  await ctx.answerCb('Раздел доступен только владельцу.', true);
}

function parseIntOr(s, fallback) {
  const n = parseInt(s, 10);
  return Number.isSafeInteger(n) ? n : fallback;
}

function fmtDate(dayIso) {
  return fmtDmyWd(dayIso);
}
