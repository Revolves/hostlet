import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/database.js';
import { createAccounts } from '../server/accounts.js';
import { runCli } from '../server/provision-account-cli.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostlet-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { DATA_DIR: dir, MULTIUSER_ENABLED: 'true', ADMIN_PASSWORD: 'test-admin-password', APP_SECRET: 'a'.repeat(32), SMTP_HOST: 'smtp.example.org', SMTP_FROM: 'noreply@example.org', ADMIN_ORIGIN: 'https://admin.example.org', COOKIE_SECURE: 'true' };
  let output = '';
  const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
  const input = new PassThrough();
  return { dir, env, input, stream, output: () => output };
}

test('CLI uses configured mailer and creates an account that requires email verification', async t => {
  const s = setup(t); let mail;
  s.input.end('a sufficiently long password\n');
  const code = await runCli({ args: ['--email', 'Alice@example.org'], env: s.env, input: s.input, output: s.stream, errorOutput: s.stream,
    createTransport: () => ({ sendMail: async message => { mail = message; return { accepted: [message.to], rejected: [] }; } }) });
  assert.equal(code, 0);
  const token = new URL(mail.text.match(/https:\/\/[^\s]+/)[0]).hash.slice(7);
  assert.equal(mail.to, 'alice@example.org');
  assert.ok(!s.output().includes(token));
  assert.ok(!s.output().includes('a sufficiently long password'));
  const db = openDatabase(path.join(s.dir, 'hostlet.sqlite'));
  try {
    const accounts = createAccounts({ db, sender: async () => {} });
    assert.equal(await accounts.authenticate({ email: mail.to, password: 'a sufficiently long password' }), null);
    assert.equal(accounts.verifyEmail(token), true);
    assert.ok(await accounts.authenticate({ email: mail.to, password: 'a sufficiently long password' }));
  } finally { db.close(); }
});

test('password command arguments are rejected without echo or database access', async t => {
  const s = setup(t); const secret = 'do-not-print-this-password';
  const code = await runCli({ args: ['--email', 'a@example.org', '--password', secret], env: s.env, input: s.input, output: s.stream, errorOutput: s.stream });
  assert.equal(code, 1); assert.ok(!s.output().includes(secret));
  assert.equal(fs.existsSync(path.join(s.dir, 'hostlet.sqlite')), false);
});

test('invalid SMTP configuration is rejected before reading password or opening database', async t => {
  const s = setup(t); s.env.SMTP_HOST = '';
  const code = await runCli({ args: ['--email', 'a@example.org'], env: s.env, input: s.input, output: s.stream, errorOutput: s.stream });
  assert.equal(code, 1); assert.equal(fs.existsSync(path.join(s.dir, 'hostlet.sqlite')), false);
});

test('terminal password entry disables echo and restores terminal mode', async t => {
  const s = setup(t); const modes = [];
  s.input.isTTY = true; s.input.setRawMode = mode => { modes.push(mode); return s.input; };
  const running = runCli({ args: ['--email', 'a@example.org'], env: s.env, input: s.input, output: s.stream, errorOutput: s.stream,
    createTransport: () => ({ sendMail: async message => ({ accepted: [message.to], rejected: [] }) }) });
  s.input.write('a sufficiently long passwore\x7fd\r');
  assert.equal(await running, 0);
  assert.deepEqual(modes, [true, false]);
  assert.ok(!s.output().includes('sufficiently long'));
});

test('rejects multiple lines of piped password without leaking input', async t => {
  const s = setup(t); s.input.end('first secret password\nsecond secret password\n');
  const code = await runCli({ args: ['--email', 'a@example.org'], env: s.env, input: s.input, output: s.stream, errorOutput: s.stream });
  assert.equal(code, 1); assert.ok(!s.output().includes('secret password'));
  assert.equal(fs.existsSync(path.join(s.dir, 'hostlet.sqlite')), false);
});

test('mail failure is sanitized and the new account can be retried', async t => {
  const s = setup(t); s.input.end('a sufficiently long password\n');
  const code = await runCli({ args: ['--email', 'a@example.org'], env: s.env, input: s.input, output: s.stream, errorOutput: s.stream,
    createTransport: () => ({ sendMail: async message => { throw new Error(message.text + ' a sufficiently long password'); } }) });
  assert.equal(code, 1);
  assert.match(s.output(), /delivery failed/i);
  assert.ok(!s.output().includes('a sufficiently long password'));
  assert.ok(!s.output().includes('#token='));
  const db = openDatabase(path.join(s.dir, 'hostlet.sqlite'));
  try { assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 0); } finally { db.close(); }
});

test('standalone entry point provides help and rejects password arguments without exposing them', () => {
  const entry = fileURLToPath(new URL('../server/provision-account-cli.js', import.meta.url));
  const help = spawnSync(process.execPath, [entry, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /--email/);
  const secret = 'do-not-print-this-password';
  const bad = spawnSync(process.execPath, [entry, '--email', 'a@example.org', '--password', secret], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.ok(!(bad.stdout + bad.stderr).includes(secret));
});
