# Manicure bot

The Cloudflare Worker in `src/worker.js` handles Telegram webhook updates and scheduled reminders. `src/handlers/` contains the conversation routes. `src/lib/repo.js` runs parameterized SQLite queries through the D1 adapter. Change the database schema with a new SQL migration in `migrations/`. Existing migrations may already have been applied.

Run `npm test` with Node.js 24. All tests run without bot credentials. Use a separate test bot and database for checks that send real Telegram messages.

`ops/deploy.mjs` runs in GitHub Actions. Cloudflare and Telegram tokens are supplied as repository secrets. Keep local credentials, database files and CSV exports out of Git.
