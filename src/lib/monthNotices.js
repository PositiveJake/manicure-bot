import { MONTH_REVIEW_DAYS, MONTH_REVIEW_TIME } from './config.js';
import { fmtDmyWd, hm, monthBounds, monthTitle, nowLocal, shiftYm, shiftYmd, ymd, ymOfYmd } from './dates.js';
import { monthNoticeKb } from './keyboards.js';
import { claimMonthNotice, markMonthNoticeSent } from './repo.js';

export async function sendMonthNotices(api, db, ownerIds, now = nowLocal(), timestamp = Date.now()) {
  const today = ymd(now);
  const month = shiftYm(ymOfYmd(today), 1);
  const { first } = monthBounds(month);
  const due = shiftYmd(first, -MONTH_REVIEW_DAYS);
  if (`${today}T${hm(now)}` < `${due}T${MONTH_REVIEW_TIME}`) return;

  const until = timestamp + 15 * 60_000;
  for (const ownerId of ownerIds) {
    if (!await claimMonthNotice(db, month, ownerId, timestamp, until)) continue;
    try {
      await api.sendMessage({
        chat_id: ownerId,
        text: `🗓 <b>Проверьте окна · ${monthTitle(month)}</b>\n\n` +
          `Клиенты увидят выбранные окна с ${fmtDmyWd(first)} по московскому времени. Проверьте рабочие дни и время.`,
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
