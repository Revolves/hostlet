import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/database.js';
import { createApps } from '../server/app.js';

const password = 'a sufficiently long password';

test('username account signs in, creates its own API key and authenticates the CLI', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostlet-username-'));
  const db = openDatabase(':memory:');
  const config = loadConfig({
    ADMIN_PASSWORD: 'test-admin-password',
    APP_SECRET: '0123456789abcdef0123456789abcdef',
    DATA_DIR: dir,
    MULTIUSER_ENABLED: 'true',
    USERNAME_REGISTRATION_ENABLED: 'true',
    REGISTRATION_ENABLED: 'true',
  });
  const { admin } = await createApps({ config, db });
  const server = http.createServer(admin);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  config.allowedOrigins.splice(0, config.allowedOrigins.length, base);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const call = (url, method = 'GET', body, cookie, origin = base) => fetch(base + url, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const features = await (await call('/api/features')).json();
  assert.equal(features.registration, true);
  assert.deepEqual(features.registrationMethods, { email: false, username: true });

  const registered = await call('/api/account/register', 'POST', { identifier: 'alice_01', password });
  assert.equal(registered.status, 201);
  const account = await registered.json();
  assert.equal(account.account.username, 'alice_01');
  const cookie = registered.headers.getSetCookie()[0].split(';')[0];
  assert.match(cookie, /hostlet_account=/);

  const me = await (await call('/api/account/me', 'GET', undefined, cookie)).json();
  assert.equal(me.account.username, 'alice_01');

  const login = await call('/api/account/login', 'POST', { identifier: 'Alice_01', password });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).account.username, 'alice_01');

  const duplicate = await call('/api/account/register', 'POST', { identifier: 'ALICE_01', password });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'ACCOUNT_EXISTS');

  const created = await call('/api/account/credentials', 'POST', {
    name: 'CLI / Skill',
    password,
    scopes: ['read', 'publish', 'share'],
    expiresAt: Date.now() + 30 * 86400000,
  }, cookie);
  assert.equal(created.status, 201);
  const credential = await created.json();
  assert.match(credential.token, /^[A-Za-z0-9_-]{43}$/);

  const workspaces = await fetch(`${base}/api/cli/workspaces`, {
    headers: { Authorization: `Bearer ${credential.token}` },
  });
  assert.equal(workspaces.status, 200);
  assert.equal((await workspaces.json()).length, 1);
});

test('username API key publishes the public showcase through the real CLI', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostlet-username-publish-'));
  const db = openDatabase(':memory:');
  const config = loadConfig({
    ADMIN_PASSWORD: 'test-admin-password',
    APP_SECRET: '0123456789abcdef0123456789abcdef',
    DATA_DIR: dir,
    MULTIUSER_ENABLED: 'true',
    USERNAME_REGISTRATION_ENABLED: 'true',
    REGISTRATION_ENABLED: 'true',
  });
  config.hosting = { appDomain: 'apps.example.test', managementOrigin: 'https://admin.hostlet.test' };
  const { admin } = await createApps({ config, db });
  const server = http.createServer(admin);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  config.allowedOrigins.splice(0, config.allowedOrigins.length, base);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const call = (url, method = 'GET', body, cookie) => fetch(base + url, {
    method,
    headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const registered = await call('/api/account/register', 'POST', { identifier: 'showcase_owner', password });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.getSetCookie()[0].split(';')[0];
  const created = await call('/api/account/credentials', 'POST', {
    name: 'Skill publisher',
    password,
    scopes: ['read', 'publish'],
    expiresAt: Date.now() + 30 * 86400000,
  }, cookie);
  assert.equal(created.status, 201);
  const { token } = await created.json();
  const spaces = await (await call('/api/workspaces', 'GET', undefined, cookie)).json();
  assert.equal(spaces.length, 1);

  const exec = promisify(execFile);
  const cli = await exec(process.execPath, [
    'cli/hostlet.js', 'publish', 'showcase/hostlet',
    '--workspace', spaces[0].id,
    '--title', 'Hostlet · 把作品发布成一个地址',
    '--json',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, HOSTLET_URL: base, HOSTLET_TOKEN: token },
  });
  const published = JSON.parse(cli.stdout);
  assert.equal(published.page.accessMode, 'private');
  assert.match(published.page.id, /^w-[a-f0-9]{32}$/);
  assert.equal(published.page.title, 'Hostlet · 把作品发布成一个地址');
  const listed = await (await call('/api/workspaces', 'GET', undefined, cookie)).json();
  assert.equal(listed.length, 1);
});
