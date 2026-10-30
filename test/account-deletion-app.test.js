import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/database.js';
import { loadConfig } from '../server/config.js';
import { createApps } from '../server/app.js';
import { accountDeletionJournalSql } from '../server/account-deletion.js';

test('account deletion removes personal hosting, revokes sessions and permits safe re-registration', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostlet-account-deletion-'));
  const db = openDatabase(':memory:');
  const messages = [];
  const config = loadConfig({ ADMIN_PASSWORD: 'test-admin-password', APP_SECRET: '0123456789abcdef0123456789abcdef', DATA_DIR: dir });
  config.registrationEnabled = true;
  const apps = await createApps({ config, db, accountSender: async message => messages.push(message) });
  const server = http.createServer(apps.admin);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  config.allowedOrigins.splice(0, config.allowedOrigins.length, base);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const post = (url, body, cookie) => fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const email = 'delete-me@example.org';
  const password = 'a sufficiently long password';
  assert.equal((await post('/api/account/register', { email, password })).status, 202);
  assert.equal((await post('/api/account/verify', { token: messages.at(-1).token })).status, 200);
  const login = await post('/api/account/login', { email, password });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const spaces = await (await fetch(base + '/api/workspaces', { headers: { Cookie: cookie } })).json();
  const space = spaces[0];
  const form = new FormData();
  form.set('title', 'Delete me');
  form.set('file', new Blob(['<!doctype html><h1>temporary</h1>']), 'index.html');
  const upload = await fetch(`${base}/api/workspaces/${space.id}/pages`, {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie },
    body: form,
  });
  assert.equal(upload.status, 201);
  const page = (await upload.json()).page;
  assert.equal(await fs.stat(path.join(dir, 'workspace-storage', 'sites', page.id)).then(() => true, () => false), true);

  const preview = await fetch(base + '/api/account/deletion', { headers: { Cookie: cookie } });
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), { deletion: { canDelete: true, blockedTeams: [] } });
  const removed = await fetch(base + '/api/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
    body: JSON.stringify({ password }),
  });
  assert.equal(removed.status, 204);
  assert.match(removed.headers.getSetCookie()?.[0] || '', /hostlet_account=/);
  assert.equal((await fetch(base + '/api/workspaces', { headers: { Cookie: cookie } })).status, 401);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages WHERE id=?').get(page.id).n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM workspaces WHERE id=?').get(space.id).n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_deletion_journal').get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM platform_admin_audit WHERE action='account.deleted'").get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM users WHERE email=?').get(email).n, 0);
  assert.equal(await fs.stat(path.join(dir, 'workspace-storage', 'sites', page.id)).then(() => true, () => false), false);
  await new Promise(resolve => setTimeout(resolve, 20));
  const logFiles = await fs.readdir(path.join(dir, 'security-logs'));
  const securityContents = (await Promise.all(logFiles.map(name => fs.readFile(path.join(dir, 'security-logs', name), 'utf8')))).join('\n');
  assert.match(securityContents, /"route":"\/api\/account"/);
  for (const sensitive of [email, password, cookie]) assert.ok(!securityContents.includes(sensitive));

  const again = await post('/api/account/register', { email, password });
  assert.equal(again.status, 202);
  assert.equal(db.prepare('SELECT count(*) n FROM users WHERE email=?').get(email).n, 1);
});

test('startup resumes an interrupted account deletion before serving requests', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostlet-account-recovery-'));
  const databaseFile = path.join(dir, 'hostlet.sqlite');
  const config = loadConfig({ ADMIN_PASSWORD: 'test-admin-password', APP_SECRET: '0123456789abcdef0123456789abcdef', DATA_DIR: dir });
  config.registrationEnabled = true;
  const messages = [];
  let firstDb = openDatabase(databaseFile);
  let recoveredDb = null;
  firstDb.exec(accountDeletionJournalSql);
  let firstApps = await createApps({ config, db: firstDb, accountSender: async message => messages.push(message) });
  let server = http.createServer(firstApps.admin);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    try { firstDb?.close(); } catch { /* Already closed after the simulated interruption. */ }
    try { recoveredDb?.close(); } catch { /* Test assertions may already have closed it. */ }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  config.allowedOrigins.splice(0, config.allowedOrigins.length, base);
  const post = (url, body, cookie) => fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const email = 'recover-me@example.org';
  const password = 'a sufficiently long password';
  assert.equal((await post('/api/account/register', { email, password })).status, 202);
  assert.equal((await post('/api/account/verify', { token: messages.at(-1).token })).status, 200);
  const login = await post('/api/account/login', { email, password });
  const account = (await login.json()).account;
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const spaces = await (await fetch(base + '/api/workspaces', { headers: { Cookie: cookie } })).json();
  const space = spaces[0];
  const form = new FormData();
  form.set('title', 'Recover me');
  form.set('file', new Blob(['<!doctype html><h1>recoverable</h1>']), 'index.html');
  const upload = await fetch(`${base}/api/workspaces/${space.id}/pages`, {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie },
    body: form,
  });
  assert.equal(upload.status, 201);
  const page = (await upload.json()).page;
  firstDb.prepare('INSERT INTO account_deletion_journal VALUES (?,?,?)').run(account.id, space.id, 5000);
  await new Promise(resolve => server.close(resolve));
  firstDb.close();
  firstDb = null;

  recoveredDb = openDatabase(databaseFile);
  firstApps = await createApps({ config, db: recoveredDb, accountSender: async message => messages.push(message) });
  assert.equal(recoveredDb.prepare('SELECT count(*) n FROM account_deletion_journal').get().n, 0);
  assert.equal(recoveredDb.prepare('SELECT count(*) n FROM workspace_pages WHERE id=?').get(page.id).n, 0);
  assert.equal(recoveredDb.prepare('SELECT count(*) n FROM workspaces WHERE id=?').get(space.id).n, 0);
  assert.match(recoveredDb.prepare('SELECT email FROM users WHERE id=?').get(account.id).email, /^deleted-/);
  assert.deepEqual(recoveredDb.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(await fs.stat(path.join(dir, 'workspace-storage', 'sites', page.id)).then(() => true, () => false), false);
});
