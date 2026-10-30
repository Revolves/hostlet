// Disposable single-IP browser security lab. Never uses configured data or a browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../../server/database.js';
import { loadConfig } from '../../server/config.js';
import { createApps } from '../../server/app.js';
import { createAccounts } from '../../server/accounts.js';

const { HOSTLET_PLAYWRIGHT_MODULE: playwrightPath, HOSTLET_CHROME: chromePath, HOSTLET_OPENSSL: opensslPath } = process.env;
if (![playwrightPath, chromePath, opensslPath].every(value => value && path.isAbsolute(value))) throw new Error('Set the three HOSTLET tool paths to absolute paths.');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostlet-single-ip-lab-'));
const servers = [];
let db, browser, apps, phase = 'setup', failed = false;
const checks = [];
const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
});
try {
  const key = path.join(temp, 'key.pem'), cert = path.join(temp, 'cert.pem');
  phase = 'temporary certificate';
  execFileSync(opensslPath, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const tls = { key: await fs.readFile(key), cert: await fs.readFile(cert) };
  let adminHandler = (_req, res) => res.writeHead(503).end();
  let contentHandler = adminHandler;
  const adminServer = https.createServer(tls, (req, res) => adminHandler(req, res));
  const contentServer = https.createServer(tls, (req, res) => contentHandler(req, res));
  servers.push(adminServer, contentServer);
  phase = 'loopback listeners';
  await listen(adminServer); await listen(contentServer);
  const managementOrigin = `https://127.0.0.1:${adminServer.address().port}`;
  const contentOrigin = `https://127.0.0.1:${contentServer.address().port}`;
  const config = loadConfig({ ADMIN_PASSWORD: 'lab-only-administrator-password', APP_SECRET: 'lab-only-secret-0123456789abcdef0123456789', DATA_DIR: temp, ADMIN_ORIGIN: managementOrigin, COOKIE_SECURE: 'true', MULTIUSER_ENABLED: 'true', SMTP_HOST: 'unused.invalid', SMTP_FROM: 'lab@example.invalid' });
  config.ipHosting = { managementOrigin, contentOrigin };
  phase = 'temporary database';
  db = openDatabase(path.join(temp, 'lab.sqlite'));
  const mail = [];
  const accounts = createAccounts({ db, sender: async message => { mail.push(message); } });
  const email = 'trusted@example.invalid', password = 'lab-only-account-password';
  await accounts.register({ email, password });
  check(mail.length === 1 && accounts.verifyEmail(mail[0].token), 'trusted synthetic account provisioned via simulated mail');
  db.prepare('INSERT INTO platform_settings VALUES (1,?)').run(JSON.stringify({ registrationEnabled: true, retention: { mode: 'long-term', days: null, notifyBeforeDays: null }, defaultQuotas: { maxApps: 20, maxStorageBytes: 1073741824, maxUploadBytes: 52428800 } }));
  phase = 'application initialization';
  apps = await createApps({ config, db, accountSender: async message => { mail.push(message); }, retentionSender: async () => true });
  adminHandler = apps.admin; contentHandler = apps.hosted;
  phase = 'isolated Chrome launch';
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-proxy-server', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US' });
  // Prevent navigation or requests to anything except the two disposable listeners.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return [managementOrigin, contentOrigin].includes(url.origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  phase = 'closed registration and login';
  await page.goto(`${managementOrigin}/account`);
  const initial = await page.evaluate(async () => {
    const features = await (await fetch('/api/features')).json();
    const registration = await fetch('/api/account/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { registration: registration.status, feature: features.registration, content: features.ipHostingOrigin };
  });
  check(initial.registration === 403 && initial.feature === false && initial.content === contentOrigin, 'registration closed despite persisted open setting');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Upload application' }).waitFor();
  check(true, 'trusted account browser login');
  phase = 'upload and private ticket exchange';
  for (const title of ['IP lab A', 'IP lab B']) {
    await page.getByLabel('Application title').fill(title);
    await page.locator('input[type=file]').first().setInputFiles({ name: 'index.html', mimeType: 'text/html', buffer: Buffer.from(`<!doctype html><title>${title}</title><h1>${title}</h1>`) });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await page.getByText(title, { exact: true }).waitFor();
  }
  const rows = db.prepare('SELECT id,title FROM workspace_pages ORDER BY title').all();
  check(rows.length === 2, 'two HTML uploads');
  const urls = rows.map(row => `${contentOrigin}/p/${row.id}/`);
  const visitor = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US' });
  await visitor.route('**/*', route => [managementOrigin, contentOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  const anonymous = await visitor.newPage();
  check((await anonymous.goto(urls[0])).status() === 401, 'anonymous private resource denied');
  const exchanges = [];
  context.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/__host/exchange')) exchanges.push({ status: response.status(), origin: response.request().headers().origin });
  });
  async function openApp(title, url) {
    const row = page.locator('.account-portal__page-list > li').filter({ hasText: title });
    const [popup] = await Promise.all([page.waitForEvent('popup'), row.getByRole('button', { name: 'Open application' }).click()]);
    await popup.waitForURL(url);
    await popup.getByRole('heading', { name: title }).waitFor();
    return popup;
  }
  const a = await openApp(rows[0].title, urls[0]);
  const b = await openApp(rows[1].title, urls[1]);
  check(exchanges.length === 2 && exchanges.every(exchange => exchange.status === 303 && exchange.origin === managementOrigin), 'browser ticket exchanges succeed');
  check((await a.evaluate(async () => (await fetch(location.href)).status)) === 200, 'private resource available with scoped session');
  phase = 'anonymous sharing and revocation';
  const appRow = page.locator('.account-portal__page-list > li').filter({ hasText: rows[0].title });
  await appRow.getByRole('button', { name: 'Share', exact: true }).click();
  await appRow.getByRole('button', { name: 'Create share', exact: true }).click();
  phase = 'share link creation';
  const shareInput = appRow.getByLabel('Share link');
  await shareInput.waitFor();
  const shareUrl = await shareInput.inputValue();
  const sharePage = await visitor.newPage();
  phase = 'anonymous share landing';
  await sharePage.goto(shareUrl);
  phase = 'anonymous share exchange';
  const [shared] = await Promise.all([sharePage.waitForEvent('popup'), sharePage.getByRole('button', { name: 'Open application' }).click()]);
  phase = 'anonymous share content';
  await shared.waitForURL(urls[0]);
  await shared.getByRole('heading', { name: rows[0].title }).waitFor();
  check(await shared.evaluate(async () => (await fetch(location.href, { cache: 'no-store' })).status) === 200, 'anonymous visitor accesses private page through a share');
  phase = 'share revocation';
  page.once('dialog', dialog => dialog.accept());
  await appRow.getByRole('button', { name: 'Revoke share' }).click();
  await appRow.getByText('Share revoked.').waitFor();
  check(await shared.evaluate(async () => (await fetch(location.href, { cache: 'no-store' })).status) === 401, 'revoked share session loses access');
  phase = 'revoked share reuse';
  await sharePage.goto(shareUrl);
  await sharePage.getByRole('button', { name: 'Open application' }).click();
  await sharePage.getByText('The link or password is invalid, expired, or revoked.').waitFor();
  check((await anonymous.goto(urls[0])).status() === 401, 'anonymous access remains denied after revocation');
  check(await a.evaluate(async () => (await fetch(location.href, { cache: 'no-store' })).status) === 200, 'owner session remains valid after share revocation');
  phase = 'shared storage and worker restriction';
  await a.evaluate(() => localStorage.setItem('ip-lab-shared', 'from-a'));
  check(await b.evaluate(() => localStorage.getItem('ip-lab-shared')) === 'from-a', 'native localStorage shared between same-origin pages');
  await b.evaluate(() => localStorage.setItem('ip-lab-shared', 'from-b'));
  check(await a.evaluate(() => localStorage.getItem('ip-lab-shared')) === 'from-b', 'native localStorage shared in both directions');
  const workers = await a.evaluate(async () => {
    const url = URL.createObjectURL(new Blob(['postMessage("running")'], { type: 'text/javascript' }));
    const dedicated = await new Promise(resolve => { try { const worker = new Worker(url); worker.onmessage = () => { worker.terminate(); resolve('running'); }; worker.onerror = event => { event.preventDefault(); worker.terminate(); resolve('blocked'); }; setTimeout(() => { worker.terminate(); resolve('timeout'); }, 2000); } catch { resolve('blocked'); } });
    URL.revokeObjectURL(url);
    let service; try { await navigator.serviceWorker.register('sw.js'); service = 'registered'; } catch { service = 'blocked'; }
    return { dedicated, service, registrations: (await navigator.serviceWorker.getRegistrations()).length };
  });
  check(workers.dedicated === 'blocked' && workers.service === 'blocked' && workers.registrations === 0, 'dedicated and service workers blocked');
  phase = 'cross-port fetch and form attacks';
  const before = db.prepare('SELECT count(*) n FROM workspaces').get().n;
  const attacks = [];
  adminServer.on('request', req => { if (req.url === '/api/workspaces' && req.method === 'POST') attacks.push({ site: req.headers['sec-fetch-site'], origin: req.headers.origin }); });
  const fetchAttack = await a.evaluate(async origin => { try { const response = await fetch(`${origin}/api/workspaces`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"forged","type":"team"}' }); return `readable:${response.status}`; } catch { return 'blocked'; } }, managementOrigin);
  check(fetchAttack === 'blocked' && attacks.length === 1 && attacks[0].site === 'same-site', 'content fetch blocked despite same-site cookies');
  const formResponse = a.waitForResponse(response => response.url() === `${managementOrigin}/api/workspaces` && response.request().method() === 'POST');
  await a.evaluate(origin => { const form = document.createElement('form'); form.method = 'POST'; form.action = `${origin}/api/workspaces`; form.target = '_self'; const input = document.createElement('input'); input.name = 'name'; input.value = 'forged'; form.append(input); document.body.append(form); form.submit(); }, managementOrigin);
  const formStatus = (await formResponse).status();
  check(formStatus === 403, 'content form rejected by management guard');
  check(attacks.length === 2 && attacks[1].site === 'same-site' && [contentOrigin, 'null'].includes(attacks[1].origin), 'content form reached management as a same-site cross-origin request');
  check(db.prepare('SELECT count(*) n FROM workspaces').get().n === before, 'cross-port attacks did not create a workspace');

  phase = 'cookie collisions';
  check(await page.evaluate(async password => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).status, config.adminPassword) === 200, 'administrator browser login');
  const cookies = await context.cookies();
  const account = cookies.find(cookie => cookie.name.startsWith('__Host-') && /account/i.test(cookie.name));
  const admin = cookies.find(cookie => cookie.name.startsWith('__Host-') && /admin/i.test(cookie.name));
  for (const [kind, original] of [['account', account], ['administrator', admin]]) {
    check(Boolean(original?.httpOnly && original.secure && original.path === '/' && !original.domain.startsWith('.')), `${kind} cookie has host prefix and required attributes`);
    await b.evaluate(name => {
      document.cookie = `${name}=forged; Path=/; Secure; SameSite=Strict`;
      document.cookie = `${name}=forged; Path=/api; Secure; SameSite=Strict`;
      document.cookie = `${name}=forged; Path=/api/workspaces; Secure; SameSite=Strict`;
    }, original.name);
    const after = (await context.cookies()).filter(cookie => cookie.name === original.name);
    check(after.length === 1 && after[0].path === '/' && after[0].httpOnly && after[0].value === original.value, `${kind} cookie cannot be overwritten or shadowed by a different path`);
  }
  check(await page.evaluate(async () => (await fetch('/api/workspaces')).status) === 200, 'account session remains available after collision attempts');
  check(await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).authenticated) === true, 'administrator session remains available after collision attempts');
  await visitor.close(); await context.close();
} catch (error) {
  failed = true;
  // Do not print browser errors, URLs, request bodies, tokens or passwords.
  console.error(`FAIL at ${phase}: ${error instanceof assert.AssertionError ? error.message : error.name}`);
} finally {
  const cleanupErrors = [];
  for (const [name, action] of [
    ['retention scheduler', async () => apps?.retentionScheduler?.stop()],
    ['cleanup scheduler', async () => apps?.ephemeralCleanupScheduler?.stop()],
    ['browser', async () => browser?.close()],
    ['HTTPS listeners', async () => Promise.all(servers.map(server => new Promise((resolve, reject) => { if (!server.listening) return resolve(); server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); })))],
    ['database', async () => db?.close()],
    ['temporary directory', async () => fs.rm(temp, { recursive: true, force: true })],
  ]) { try { await action(); } catch { cleanupErrors.push(name); } }
  if (cleanupErrors.length) { failed = true; console.error(`Cleanup failed: ${cleanupErrors.join(', ')}`); }
}
for (const name of checks) console.log(`PASS: ${name}`);
if (failed) process.exitCode = 1;
else console.log('PASS: disposable single-IP HTTPS browser lab completed and cleaned up.');








