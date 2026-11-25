import { MONTH_REVIEW_TIME } from './config.js';
import { fmtDmyWd, hm, monthTitle, nowLocal, shiftYm, shiftYmd, ymd, ymOfYmd } from './dates.js';
import { monthNoticeKb } from './keyboards.js';
import { claimMonthNotice, markMonthNoticeSent } from './repo.js';
import { bookingOpensOn } from './slotRules.js';

export async function sendMonthNotices(api, db, ownerIds, now = nowLocal(), timestamp = Date.now()) {
  const today = ymd(now);
  const month = shiftYm(ymOfYmd(today), 1);
  const opens = bookingOpensOn(month);
  const due = shiftYmd(opens, -1);
  if (today !== due || hm(now) < MONTH_REVIEW_TIME) return;

  const until = timestamp + 15 * 60_000;
  for (const ownerId of ownerIds) {
    if (!await claimMonthNotice(db, month, ownerId, timestamp, until)) continue;
    try {
      await api.sendMessage({
        chat_id: ownerId,
        text: `🗓 <b>Проверьте окна · ${monthTitle(month)}</b>\n\n` +
          `Запись откроется ${fmtDmyWd(opens)} в 00:00 по Москве. Проверьте рабочие дни и время до открытия.`,
        parse_mode: 'HTML',
        reply_markup: monthNoticeKb(month),
      });
    } catch {
      console.warn('Month notice delivery will be retried');
      continue;
    }
    await markMonthNoticeSent(db, month, ownerId, until);
  }
}
