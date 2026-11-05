import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/database.js';
import { createApiCredentials } from '../server/api-credentials.js';

const fixture = fileURLToPath(new URL('./fixtures/idempotent-crash-server.mjs', import.meta.url));
const workspace = 'crash-test-workspace';
const original = Buffer.from('<h1>existing release</h1>');
const replacement = Buffer.from('<h1>replacement release</h1>');

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hostlet-idempotent-crash-'));
  const db = openDatabase(path.join(root, 'hostlet.sqlite'));
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('crash-user', 'crash@example.org', 'hash', 1, 1);
  db.prepare('INSERT INTO workspaces VALUES (?,?,?,?,?)').run(workspace, 'Test', 'personal', 'crash-user', 'now');
  db.prepare('INSERT INTO workspace_members VALUES (?,?,?,?)').run(workspace, 'crash-user', 'owner', 'now');
  const token = createApiCredentials({ db }).create('crash-user', { name: 'test', scopes: ['read', 'publish'], expiresAt: Date.now() + 86400000 }).token;
  db.close();
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function start() {
    child = fork(fixture, [root], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--no-warnings=ExperimentalWarning'] });
    const [message] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(([code]) => { throw new Error(`server exited before listening (${code})`); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timed out')), 10000).unref())
    ]);
    assert.ok(message.port);
    return `http://127.0.0.1:${message.port}`;
  }
  async function crash() {
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  }
  function recoverLock() {
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'wait for the crashed process before offline lock recovery');
    fs.rmSync(path.join(root, '.hostlet-instance-lock'), { recursive: true });
  }
  return { root, token, start, crash, recoverLock, get child() { return child; } };
}

function headers(token, key, bytes) {
  return { Authorization: `Bearer ${token}`, 'Idempotency-Key': key, 'X-Content-SHA256': createHash('sha256').update(bytes).digest('hex'), 'X-Content-Length': String(bytes.length) };
}
function publish(base, token, key, bytes, page) {
  const form = new FormData();
  if (page) form.set('revision', String(page.revision)); else form.set('title', 'Existing page');
  form.set('file', new Blob([bytes]), 'index.html');
  return fetch(`${base}/api/cli/workspaces/${workspace}/pages${page ? `/${page.id}/replace` : ''}`, { method: 'POST', headers: headers(token, key, bytes), body: form });
}
async function status(base, token, key) {
  const response = await fetch(`${base}/api/cli/workspaces/${workspace}/publications/${key}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200, 'status query must be available');
  return response.json();
}
async function baseline(base, token) {
  const response = await publish(base, token, 'baseline_request_0000000001', original);
  assert.equal(response.status, 201);
  return (await response.json()).page;
}
function releaseFile(root, page) {
  return path.join(root, 'workspace-storage', 'sites', page.id, 'releases', page.releaseId, 'index.html');
}
function assertCounts(root, pageId, releases, revision) {
  const db = openDatabase(path.join(root, 'hostlet.sqlite'));
  try {
    assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages WHERE workspace_id=?').get(workspace).n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM workspace_page_releases WHERE page_id=?').get(pageId).n, releases);
    assert.equal(db.prepare('SELECT revision FROM workspace_page_revisions WHERE page_id=?').get(pageId).revision, revision);
    assert.equal(db.prepare("SELECT count(*) n FROM workspace_audit WHERE page_id=? AND action='page.cli_published'").get(pageId).n, releases);
  } finally { db.close(); }
}

test('a claimed incomplete upload is interrupted after a crash and can be retried without losing the existing release', { timeout: 30000 }, async t => {
  const x = await setup(t); let base = await x.start();
  const page = await baseline(base, x.token);
  assert.equal(fs.readFileSync(releaseFile(x.root, page), 'utf8'), original.toString());
  const key = 'interrupted_request_0000001';
  const boundary = 'crash-test-boundary';
  const req = http.request(`${base}/api/cli/workspaces/${workspace}/pages/${page.id}/replace`, {
    method: 'POST', headers: { ...headers(x.token, key, replacement), 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Transfer-Encoding': 'chunked' }
  });
  req.on('error', () => {});
  req.write(`--${boundary}\r\nContent-Disposition: form-data; name="revision"\r\n\r\n${page.revision}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n`);
  req.write(replacement.subarray(0, 5));
  let observed;
  for (let i = 0; i < 100; i++) {
    observed = await status(base, x.token, key);
    if (observed.status === 'in_progress') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(observed.status, 'in_progress', 'the server must claim the request before termination');
  await x.crash(); req.destroy(); x.recoverLock(); base = await x.start();
  assert.equal((await status(base, x.token, key)).status, 'interrupted');
  assert.equal(fs.readFileSync(releaseFile(x.root, page), 'utf8'), original.toString());
  assertCounts(x.root, page.id, 1, page.revision);
  const retry = await publish(base, x.token, key, replacement, page);
  assert.equal(retry.status, 200);
  const result = await retry.json();
  assert.equal(result.page.revision, page.revision + 1);
  assert.equal(fs.readFileSync(releaseFile(x.root, page), 'utf8'), original.toString());
  assert.equal(fs.readFileSync(releaseFile(x.root, result.page), 'utf8'), replacement.toString());
  assertCounts(x.root, page.id, 2, page.revision + 1);
});

test('a committed replacement survives a lost response and replay returns the same result once', { timeout: 30000 }, async t => {
  const x = await setup(t); let base = await x.start();
  const page = await baseline(base, x.token), key = 'committed_request_000000001';
  const armed = once(x.child, 'message'); x.child.send('response'); assert.equal((await armed)[0], 'armed');
  const exited = once(x.child, 'exit');
  await assert.rejects(publish(base, x.token, key, replacement, page));
  assert.equal((await exited)[0], 73, 'termination must occur before the successful response is sent');
  x.recoverLock(); base = await x.start();
  const receipt = await status(base, x.token, key);
  assert.equal(receipt.status, 'succeeded');
  assert.ok(receipt.result, 'successful status must contain the committed result');
  const replay = await publish(base, x.token, key, replacement, page);
  assert.equal(replay.status, 200);
  const result = await replay.json();
  assert.deepEqual(receipt.result, result);
  assert.equal(result.page.id, page.id);
  assert.equal(result.page.revision, page.revision + 1);
  assert.equal(fs.readFileSync(releaseFile(x.root, page), 'utf8'), original.toString());
  assert.equal(fs.readFileSync(releaseFile(x.root, result.page), 'utf8'), replacement.toString());
  assertCounts(x.root, page.id, 2, page.revision + 1);
});

for (const [window, exitCode] of [['before-move', 74], ['after-move', 75]]) {
  test(`replacement interrupted ${window} rolls back and is safely retried`, { timeout: 30000 }, async t => {
    const x = await setup(t); let base = await x.start();
    const page = await baseline(base, x.token), key = `move_${window.replace('-', '_')}_request_000001`;
    const armed = once(x.child, 'message'); x.child.send(window); assert.equal((await armed)[0], 'armed');
    const exited = once(x.child, 'exit');
    await assert.rejects(publish(base, x.token, key, replacement, page));
    assert.equal((await exited)[0], exitCode, 'the requested file-move window must actually be reached');
    x.recoverLock(); base = await x.start();
    assert.equal((await status(base, x.token, key)).status, 'interrupted');
    assert.equal(fs.readFileSync(releaseFile(x.root, page), 'utf8'), original.toString());
    assertCounts(x.root, page.id, 1, page.revision);
    const retry = await publish(base, x.token, key, replacement, page);
    assert.equal(retry.status, 200);
    const result = await retry.json();
    assert.equal(result.page.id, page.id);
    assert.equal(result.page.revision, page.revision + 1);
    assert.equal(fs.readFileSync(releaseFile(x.root, page), 'utf8'), original.toString());
    assert.equal(fs.readFileSync(releaseFile(x.root, result.page), 'utf8'), replacement.toString());
    assertCounts(x.root, page.id, 2, page.revision + 1);
  });
}
