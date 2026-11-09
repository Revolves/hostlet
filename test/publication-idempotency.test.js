import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/database.js';
import { latestDatabaseVersion } from '../server/migrations.js';
import { createPublicationIdempotency } from '../server/publication-idempotency.js';
import * as receipts from '../server/publication-idempotency.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostlet-receipts-'));
  const file = path.join(dir, 'db.sqlite');
  const db = openDatabase(file);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, file, service: () => createPublicationIdempotency(db) };
}
const base = { actor: 'user', workspace: 'space', key: 'abcdefghijklmnopqrstuv' };
const headerFingerprint = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
const claim = s => s.claim({ ...base, headerFingerprint });
const bind = s => s.bind({ ...base, fingerprint });
const result = { pageId: 'p', versionId: 'v', revision: 2 };
const transaction = (db, callback) => {
  if (typeof db.isTransaction !== 'boolean') return receipts.withPublicationTransaction(db, callback);
  db.exec('BEGIN');
  try {
    const value = callback();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
};

test('succeed outside a caller transaction fails without creating a false success', t => {
  const { db, service } = setup(t), owner = service();
  claim(owner); bind(owner);
  const code = typeof db.isTransaction === 'boolean' ? 'TRANSACTION_REQUIRED' : 'TRANSACTION_STATE_UNAVAILABLE';
  assert.throws(() => owner.succeed({ ...base, fingerprint, result }), { code });
  assert.deepEqual(owner.status(base), { status: 'in_progress' });
});

test('succeed fails closed if SQLite transaction state is unavailable', t => {
  const { db } = setup(t);
  const wrapped = new Proxy(db, { get(target, property) {
    if (property === 'isTransaction') return undefined;
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const owner = createPublicationIdempotency(wrapped);
  claim(owner); bind(owner); db.exec('BEGIN');
  assert.throws(() => owner.succeed({ ...base, fingerprint, result }), { code: 'TRANSACTION_STATE_UNAVAILABLE' });
  db.exec('ROLLBACK');
  assert.deepEqual(owner.status(base), { status: 'in_progress' });
});

test('explicit transaction wrapper supports older SQLite bindings and rolls back publication with receipt', t => {
  const { db } = setup(t);
  const wrapped = new Proxy(db, { get(target, property) {
    if (property === 'isTransaction') return undefined;
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const owner = createPublicationIdempotency(wrapped);
  claim(owner); bind(owner); db.exec('CREATE TABLE published(id TEXT)');
  assert.throws(() => receipts.withPublicationTransaction(wrapped, () => {
    db.prepare('INSERT INTO published VALUES (?)').run('p');
    owner.succeed({ ...base, fingerprint, result });
    throw new Error('publication failed');
  }), /publication failed/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM published').get().n, 0);
  assert.deepEqual(owner.status(base), { status: 'in_progress' });
  receipts.withPublicationTransaction(wrapped, () => {
    db.prepare('INSERT INTO published VALUES (?)').run('p');
    owner.succeed({ ...base, fingerprint, result });
  });
  assert.equal(db.prepare('SELECT count(*) AS n FROM published').get().n, 1);
  assert.deepEqual(owner.status(base), { status: 'succeeded', result });
});

test('account deletion removes only that actor receipts across workspaces and rolls back atomically', t => {
  const { db, service } = setup(t);
  db.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES ('u1','u1@example.test','hash',1),('u2','u2@example.test','hash',1)");
  for (const [actor, workspace] of [['u1','personal'], ['u1','team'], ['u2','team']]) {
    service().claim({ actor, workspace, key: base.key, headerFingerprint });
  }
  db.exec("BEGIN; UPDATE users SET password_hash='!deleted' WHERE id='u1'");
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'personal' }), { status: 'not_found' });
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'team' }), { status: 'not_found' });
  assert.deepEqual(service().status({ ...base, actor: 'u2', workspace: 'team' }), { status: 'in_progress' });
  db.exec('ROLLBACK');
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'team' }), { status: 'in_progress' });
  db.exec("UPDATE users SET password_hash='!deleted' WHERE id='u1'");
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'personal' }), { status: 'not_found' });
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'team' }), { status: 'not_found' });
  assert.deepEqual(service().status({ ...base, actor: 'u2', workspace: 'team' }), { status: 'in_progress' });
});

test('workspace deletion removes all its receipts and leaves other workspaces intact', t => {
  const { db, service } = setup(t);
  db.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES ('u1','u1@example.test','hash',1); INSERT INTO workspaces VALUES ('w1','one','team','u1','now'),('w2','two','team','u1','now')");
  for (const [actor, workspace] of [['u1','w1'], ['u2','w1'], ['u1','w2']]) service().claim({ actor, workspace, key: base.key, headerFingerprint });
  db.exec("BEGIN; DELETE FROM workspaces WHERE id='w1'");
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'w1' }), { status: 'not_found' });
  assert.deepEqual(service().status({ ...base, actor: 'u2', workspace: 'w1' }), { status: 'not_found' });
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'w2' }), { status: 'in_progress' });
  db.exec('ROLLBACK');
  assert.deepEqual(service().status({ ...base, actor: 'u2', workspace: 'w1' }), { status: 'in_progress' });
  db.exec("DELETE FROM workspaces WHERE id='w1'");
  assert.deepEqual(service().status({ ...base, actor: 'u2', workspace: 'w1' }), { status: 'not_found' });
  assert.deepEqual(service().status({ ...base, actor: 'u1', workspace: 'w2' }), { status: 'in_progress' });
});

test('claim, bind and success are durable, isolated and require matching fingerprints for replay', t => {
  const { db, service } = setup(t), owner = service(), other = service();
  assert.deepEqual(owner.status(base), { status: 'not_found' });
  assert.deepEqual(claim(owner), { status: 'claimed' });
  assert.deepEqual(claim(other), { status: 'in_progress' });
  assert.deepEqual(other.claim({ ...base, headerFingerprint: 'c'.repeat(64) }), { status: 'conflict' });
  assert.deepEqual(bind(owner), { status: 'bound' });
  transaction(db, () => assert.deepEqual(owner.succeed({ ...base, fingerprint, result }), { status: 'succeeded', result }));
  assert.deepEqual(other.status(base), { status: 'succeeded', result });
  assert.deepEqual(claim(other), { status: 'succeeded' });
  assert.deepEqual(other.bind({ ...base, fingerprint: 'c'.repeat(64) }), { status: 'conflict' });
  assert.deepEqual(bind(other), { status: 'succeeded', result });
  for (const scope of [{ ...base, actor: 'other' }, { ...base, workspace: 'other' }]) {
    assert.deepEqual(other.status(scope), { status: 'not_found' });
    assert.deepEqual(service().claim({ ...scope, headerFingerprint }), { status: 'claimed' });
  }
});

test('rollback of caller transaction rolls back both publication and success', t => {
  const { db, service } = setup(t), owner = service();
  claim(owner); bind(owner);
  db.exec('CREATE TABLE example_publication(id TEXT)');
  assert.throws(() => transaction(db, () => {
    db.prepare('INSERT INTO example_publication VALUES (?)').run('p');
    owner.succeed({ ...base, fingerprint, result });
    throw new Error('rollback');
  }), /rollback/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM example_publication').get().n, 0);
  assert.deepEqual(owner.status(base), { status: 'in_progress' });
  assert.deepEqual(owner.interrupt(base), { status: 'interrupted' });
});

test('recovery and interruption allow matching retry while stale attempts cannot mutate it', t => {
  const { db, service } = setup(t), old = service(), next = service();
  claim(old); bind(old);
  assert.equal(service().recover(), 1);
  assert.deepEqual(old.status(base), { status: 'interrupted' });
  assert.deepEqual(next.claim({ ...base, headerFingerprint: 'c'.repeat(64) }), { status: 'conflict' });
  assert.deepEqual(claim(next), { status: 'claimed' });
  assert.deepEqual(old.interrupt(base), { status: 'in_progress' });
  assert.throws(() => bind(old), { code: 'NOT_OWNER' });
  assert.throws(() => transaction(db, () => old.succeed({ ...base, fingerprint, result })), { code: 'NOT_OWNER' });
  assert.deepEqual(next.bind({ ...base, fingerprint: 'c'.repeat(64) }), { status: 'conflict' });
  assert.deepEqual(bind(next), { status: 'bound' });
  assert.deepEqual(next.interrupt(base), { status: 'interrupted' });
  assert.throws(() => claim(next), { code: 'INSTANCE_USED' });
});

test('success survives recovery and old records are never automatically removed', t => {
  const { db, service } = setup(t), owner = service();
  claim(owner); bind(owner); transaction(db, () => owner.succeed({ ...base, fingerprint, result }));
  db.prepare('UPDATE publication_idempotency SET created_at=0, updated_at=0').run();
  assert.equal(service().recover(), 0);
  assert.deepEqual(service().status(base), { status: 'succeeded', result });
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM publication_idempotency').get()).includes(base.key), false);
});

test('invalid inputs and invalid transitions fail closed', t => {
  const { db, service } = setup(t), s = service();
  assert.throws(() => s.claim({ ...base, key: 'short', headerFingerprint }), { code: 'INVALID' });
  assert.throws(() => s.claim({ ...base, headerFingerprint: 'A'.repeat(64) }), { code: 'INVALID' });
  assert.throws(() => s.succeed({ ...base, fingerprint, result }), { code: 'NOT_OWNER' });
  claim(s);
  assert.throws(() => transaction(db, () => s.succeed({ ...base, fingerprint, result })), { code: 'NOT_OWNER' });
  bind(s);
  assert.throws(() => transaction(db, () => s.succeed({ ...base, fingerprint: 'c'.repeat(64), result })), { code: 'NOT_OWNER' });
  assert.deepEqual(s.status(base), { status: 'in_progress' });
});

test('independent processes racing to claim have exactly one winner', async t => {
  const { file, service } = setup(t);
  const script = `import { DatabaseSync } from 'node:sqlite';
    import { createPublicationIdempotency } from './server/publication-idempotency.js';
    const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=5000');
    console.log(JSON.stringify(createPublicationIdempotency(db).claim({actor:'user',workspace:'space',key:'abcdefghijklmnopqrstuv',headerFingerprint:'${headerFingerprint}'}))); db.close();`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--input-type=module', '-e', script, file], { cwd: process.cwd() });
    let out = '', err = '';
    child.stdout.on('data', data => out += data);
    child.stderr.on('data', data => err += data);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(out).status) : reject(new Error(err)));
  });
  const states = await Promise.all(Array.from({ length: 6 }, run));
  assert.equal(states.filter(value => value === 'claimed').length, 1);
  assert.equal(states.filter(value => value === 'in_progress').length, 5);
  assert.equal(service().recover(), 1);
});

test('version 24 migration preserves existing data and creates durable receipts across reopening', t => {
  const { db, file, service } = setup(t);
  db.exec("INSERT INTO pages(id,title,slug,entry_file,access_mode,source_type,original_filename,release_id,release_dir,created_at,updated_at) VALUES ('p','title','slug','index.html','private','html','index.html','r','/retained','now','now'); DROP TRIGGER workspace_public_team_release_guard; DROP TABLE workspace_publication_review; DROP TRIGGER publication_idempotency_account_deleted; DROP TRIGGER publication_idempotency_workspace_deleted; DROP TABLE publication_idempotency; PRAGMA user_version=24");
  const migrated = openDatabase(file);
  const owner = createPublicationIdempotency(migrated);
  claim(owner); bind(owner); transaction(migrated, () => owner.succeed({ ...base, fingerprint, result }));
  migrated.close();
  assert.deepEqual(service().status(base), { status: 'succeeded', result });
  assert.equal(db.prepare('SELECT release_dir FROM pages WHERE id=\'p\'').get().release_dir, '/retained');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, latestDatabaseVersion);
  const raw = new DatabaseSync(file);
  assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  raw.close();
});
