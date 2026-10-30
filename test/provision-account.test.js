import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/database.js';
import { createAccounts } from '../server/accounts.js';
import { acquireInstanceLock } from '../server/instance-lock.js';
import { provisionAccount } from '../server/provision-account.js';

function temporaryDirectory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostlet-provision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const password = 'a sufficiently long password';

test('provisions an unverified account with a real verification token and personal workspace', async t => {
  const dataDir = temporaryDirectory(t);
  let mail;
  const user = await provisionAccount({ dataDir, email: ' Alice@Example.org ', password, sender: async message => { mail = message; } });
  assert.equal(user.email, 'alice@example.org');
  assert.equal(mail.to, user.email);
  assert.equal(mail.purpose, 'verify');
  const db = openDatabase(path.join(dataDir, 'hostlet.sqlite'));
  try {
    const accounts = createAccounts({ db, sender: async () => {} });
    assert.equal(await accounts.authenticate({ email: user.email, password }), null);
    assert.equal(db.prepare('SELECT count(*) n FROM workspaces WHERE created_by = ?').get(user.id).n, 1);
    assert.equal(accounts.verifyEmail(mail.token), true);
    assert.equal((await accounts.authenticate({ email: user.email, password })).id, user.id);
    const rows = JSON.stringify(db.prepare('SELECT * FROM users').all());
    assert.ok(!rows.includes(password));
    assert.ok(!rows.includes(mail.token));
  } finally { db.close(); }
});

test('refuses an occupied data directory before opening the database', async t => {
  const dataDir = temporaryDirectory(t);
  const lock = acquireInstanceLock(dataDir);
  try {
    await assert.rejects(provisionAccount({ dataDir, email: 'a@example.org', password, sender: async () => assert.fail() }), { code: 'LOCKED' });
    assert.equal(fs.existsSync(path.join(dataDir, 'hostlet.sqlite')), false);
  } finally { lock.release(); }
});

test('holds the instance lock until the sender finishes', async t => {
  const dataDir = temporaryDirectory(t);
  await provisionAccount({ dataDir, email: 'a@example.org', password, sender: async () => {
    assert.throws(() => acquireInstanceLock(dataDir), /already in use/);
  } });
  const lock = acquireInstanceLock(dataDir); lock.release();
});

test('failed delivery removes only the new account and allows a clean retry', async t => {
  const dataDir = temporaryDirectory(t);
  let token;
  await assert.rejects(provisionAccount({ dataDir, email: 'a@example.org', password, sender: async message => {
    token = message.token; throw new Error(`${password} ${token}`);
  } }), error => error.code === 'MAIL_FAILED' && !String(error.stack).includes(password) && !String(error.stack).includes(token));
  const db = openDatabase(path.join(dataDir, 'hostlet.sqlite'));
  try {
    for (const table of ['users', 'workspaces', 'workspace_members', 'account_tokens']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  } finally { db.close(); }
  await provisionAccount({ dataDir, email: 'a@example.org', password, sender: async () => {} });
});

test('duplicate email is rejected without changing the original account or sending mail', async t => {
  const dataDir = temporaryDirectory(t);
  const first = await provisionAccount({ dataDir, email: 'a@example.org', password, sender: async () => {} });
  await assert.rejects(provisionAccount({ dataDir, email: 'A@example.org', password, sender: async () => assert.fail() }), { code: 'EMAIL_EXISTS' });
  const db = openDatabase(path.join(dataDir, 'hostlet.sqlite'));
  try {
    assert.equal(db.prepare('SELECT id FROM users').get().id, first.id);
    assert.equal(db.prepare('SELECT count(*) n FROM account_tokens').get().n, 1);
  } finally { db.close(); }
});
