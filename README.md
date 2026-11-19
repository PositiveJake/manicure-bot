# Бот записи на маникюр

Клиенты выбирают свободную среду, пятницу или воскресенье в личном чате с ботом. Для первой записи клиент подтверждает номер через кнопку Telegram «Поделиться номером». Владелец видит календарь, список клиентов и записи на ближайшие 30 дней, может отменить запись и заблокировать пользователя. Код хранится на GitHub, бот работает в Cloudflare Workers, записи хранятся в Cloudflare D1.

Worker проверяет напоминания каждые пять минут. По умолчанию отправка начинается в 12:00 накануне по Москве. Если запись добавили позже, она попадёт в ближайшую проверку до начала сеанса. Клиент и владелец получают отдельные сообщения. При временной ошибке бот повторяет отправку тому получателю, для которого она не завершилась. Владелец и клиент должны хотя бы раз открыть личный чат с ботом и нажать «Запустить».

## Первое развёртывание

1. Откройте [BotFather](https://t.me/BotFather) и получите обычный токен Telegram Bot API для нужного бота. Если прежняя Python-версия запущена с тем же токеном, остановите её перед переключением.
2. В Cloudflare откройте **Workers & Pages**. Настройте поддомен `workers.dev`, если он ещё не настроен. Скопируйте **Account ID**. Создайте API-токен для этого аккаунта с правами **Workers Scripts → Edit** и **D1 → Edit**. [Настройка поддомена](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) · [Токен для GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
3. В репозитории GitHub откройте **Settings → Secrets and variables → Actions**. Добавьте следующие значения. [Документация GitHub Secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)

   | Раздел | Имя | Значение |
   | --- | --- | --- |
   | Secrets | `CLOUDFLARE_API_TOKEN` | Токен Cloudflare |
   | Secrets | `TELEGRAM_BOT_TOKEN` | Токен из BotFather |
   | Variables | `CLOUDFLARE_ACCOUNT_ID` | Account ID в Cloudflare |
   | Secrets | `TELEGRAM_OWNER_IDS` | Числовой Telegram ID владельца. Несколько ID можно перечислить через запятую |

4. Поместите проект в основную ветку репозитория. **Actions → Manicure bot** запускается при публикации в основной ветке. Его можно повторить вручную кнопкой **Run workflow**. Он создаст базу `manicure-bookings`, применит миграции, опубликует Worker `manicure-bot` и подключит Telegram.
5. Напишите боту `/start` с аккаунта владельца. В логе успешного развёртывания будет ссылка для закреплённого сообщения в канале вида `https://t.me/ИМЯ_БОТА?start=booking`. По ней клиент попадёт в личный чат для записи.

Рабочие дни, доступное время и расписание напоминаний настраиваются в `src/lib/config.js`. Команда `/export` в личном чате владельца выгружает записи в CSV.

## Локальная проверка

Нужен Node.js 24.

```sh
npm ci
npm test
npx wrangler deploy --dry-run
npx wrangler d1 migrations apply DB --local
```
