import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parseOwnerIds } from '../src/lib/config.js';
import { createTelegramApi } from '../src/lib/telegram.js';

const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_IDS } = process.env;
const configPath = `.wrangler-deploy-${process.pid}.json`;

async function cloudflare(path, data) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/${path}`,
    {
      method: data ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(15_000),
    },
  );
  const { success, result, errors } = await response.json();
  if (!response.ok || !success) {
    throw new Error(`Cloudflare ${path.split('?')[0]} failed (HTTP ${response.status}, code ${errors?.[0]?.code ?? 'unknown'})`);
  }
  return result;
}

async function waitForWebhook(url, secret) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 204) return;
    } catch {
      // Wait for the deployed URL to propagate.
    }
    await setTimeout(2500);
  }
  throw new Error('The deployed Worker did not accept the webhook probe. Check its workers.dev route.');
}

async function verifyBot(telegram) {
  try {
    return await telegram.getMe();
  } catch (error) {
    if (error.code !== 0) throw error;
    await setTimeout(2000);
    return await telegram.getMe();
  }
}

async function deploy() {
  if (!/^\d+:[\w-]+$/.test(TELEGRAM_BOT_TOKEN ?? '')) {
    throw new Error('Set the BotFather token in the TELEGRAM_BOT_TOKEN GitHub Actions secret.');
  }
  const ownerIds = parseOwnerIds(TELEGRAM_OWNER_IDS);
  const telegram = createTelegramApi(TELEGRAM_BOT_TOKEN);
  const bot = await verifyBot(telegram);
  console.log('Telegram bot token verified.');
  if (!/^[a-f0-9]{32}$/i.test(CLOUDFLARE_ACCOUNT_ID ?? '') || !CLOUDFLARE_API_TOKEN) {
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in GitHub Actions.');
  }
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const { subdomain } = await cloudflare('workers/subdomain');
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain ?? '')) {
    throw new Error('Enable your workers.dev subdomain in the Cloudflare dashboard first.');
  }
  const url = `https://${config.name}.${subdomain}.workers.dev/telegram`;
  const database = config.d1_databases[0];
  const name = database.database_name;
  const matches = await cloudflare(`d1/database?name=${encodeURIComponent(name)}`);
  const existing = matches.find((item) => item.name === name);
  database.database_id = (existing ?? await cloudflare('d1/database', { name })).uuid;
  if (!/^[a-f0-9-]{36}$/i.test(database.database_id ?? '')) {
    throw new Error('Cloudflare did not return a valid D1 database ID.');
  }
  const secret = createHmac('sha256', TELEGRAM_BOT_TOKEN).update('manicure-bot/telegram-webhook').digest('hex');
  const dir = await mkdtemp(join(tmpdir(), 'manicure-bot-'));
  const secretsPath = join(dir, 'secrets.json');
  try {
    await writeFile(configPath, JSON.stringify(config));
    await writeFile(secretsPath, JSON.stringify({
      TELEGRAM_BOT_TOKEN,
      TELEGRAM_OWNER_IDS: ownerIds.join(','),
      TELEGRAM_WEBHOOK_SECRET: secret,
    }), { mode: 0o600 });
    const wrangler = (...args) => execFileSync(process.execPath, [
      'node_modules/wrangler/bin/wrangler.js', ...args, '--config', configPath,
    ], { stdio: 'inherit' });
    wrangler('d1', 'migrations', 'apply', name, '--remote');
    wrangler('deploy', '--secrets-file', secretsPath);

    await waitForWebhook(url, secret);
    await telegram.setWebhook({
      url,
      secret_token: secret,
      max_connections: 1,
      allowed_updates: ['message', 'callback_query'],
    });
    const info = await telegram.getWebhookInfo();
    if (info.url !== url) throw new Error('Telegram did not confirm the expected webhook URL.');
    console.log(`Telegram webhook connected. Channel link: https://t.me/${bot.username}?start=booking`);
  } finally {
    await rm(secretsPath, { force: true });
    await rmdir(dir);
    await rm(configPath, { force: true });
  }
}

try {
  await deploy();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
