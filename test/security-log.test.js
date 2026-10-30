import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createSecurityLog, createSecurityRequestLogger } from '../server/security-log.js';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostlet-security-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('security log writes bounded NDJSON fields and never records request secrets', t => {
  const dir = temp(t);
  for (const name of ['keep.txt', 'security-not-a-date.ndjson']) fs.writeFileSync(path.join(dir, name), 'keep');
  const log = createSecurityLog({ directory: dir, retentionDays: 180, now: () => Date.parse('2026-10-29T12:00:00Z') });
  assert.equal(log.record({
    method: 'POST',
    route: '/api/account/login',
    status: 401,
    durationMs: 12,
    client: '192.0.2.10',
    body: 'password=secret',
    query: '?token=secret',
  }), true);
  const contents = fs.readFileSync(path.join(dir, 'security-2026-10-29.ndjson'), 'utf8');
  const row = JSON.parse(contents.trim());
  assert.deepEqual(row, {
    time: '2026-10-29T12:00:00.000Z',
    event: 'http_request',
    method: 'POST',
    route: '/api/account/login',
    status: 401,
    durationMs: 12,
    client: '192.0.2.10',
  });
  assert.ok(!contents.includes('secret'));
  assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(dir, 'security-not-a-date.ndjson'), 'utf8'), 'keep');
});

test('security log rejects unsafe directory entries and removes only expired rotated files', t => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'security-2026-01-01.ndjson'), 'old');
  fs.writeFileSync(path.join(dir, 'security-2026-10-28.ndjson'), 'recent');
  fs.writeFileSync(path.join(dir, 'unrelated-2026-01-01.ndjson'), 'keep');
  const log = createSecurityLog({ directory: dir, retentionDays: 30, now: () => Date.parse('2026-10-29T00:00:00Z') });
  assert.equal(log.cleanup(), 1);
  assert.equal(fs.existsSync(path.join(dir, 'security-2026-01-01.ndjson')), false);
  assert.equal(fs.existsSync(path.join(dir, 'security-2026-10-28.ndjson')), true);
  assert.equal(fs.readFileSync(path.join(dir, 'unrelated-2026-01-01.ndjson'), 'utf8'), 'keep');
  assert.throws(() => createSecurityLog({ directory: path.join(dir, 'missing'), retentionDays: 0 }), /configuration|retention/i);
});

test('existing security log storage is restricted before writing', { skip: process.platform === 'win32' && 'POSIX modes unavailable' }, t => {
  const dir = temp(t);
  fs.chmodSync(dir, 0o755);
  const log = createSecurityLog({ directory: dir, now: () => Date.parse('2026-10-29T00:00:00Z') });
  assert.equal(log.record({ method: 'GET', route: '/api/health', status: 200, durationMs: 1, client: '127.0.0.1' }), true);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, 'security-2026-10-29.ndjson')).mode & 0o777, 0o600);
});

test('request logger uses route templates and excludes query, cookie and body data', async t => {
  const dir = temp(t);
  const log = createSecurityLog({ directory: dir, retentionDays: 180, now: () => Date.parse('2026-10-29T00:00:00Z') });
  const app = express();
  app.set('trust proxy', false);
  app.use(createSecurityRequestLogger({ securityLog: log, mode: 'management' }));
  app.post('/api/account/login', express.json(), (req, res) => res.status(req.body.password === 'good' ? 200 : 401).json({ ok: true }));
  app.get('/assets/app.js', (_req, res) => res.send('asset'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(base + '/api/account/login?token=top-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'secret-cookie=abc' },
    body: JSON.stringify({ email: 'person@example.org', password: 'bad-secret' }),
  });
  await fetch(base + '/assets/app.js?download=private');
  await new Promise(resolve => setTimeout(resolve, 20));
  const file = path.join(dir, 'security-2026-10-29.ndjson');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].route, '/api/account');
  assert.equal(rows[0].status, 401);
  const raw = fs.readFileSync(file, 'utf8');
  for (const secret of ['top-secret', 'secret-cookie', 'bad-secret', 'person@example.org', 'download=private']) assert.ok(!raw.includes(secret));
});
