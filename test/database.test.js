import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/database.js';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostlet-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const legacySchema = `
CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, entry_file TEXT NOT NULL, access_mode TEXT NOT NULL CHECK (access_mode IN ('public', 'private')), source_type TEXT NOT NULL CHECK (source_type IN ('html', 'zip')), original_filename TEXT NOT NULL, release_id TEXT NOT NULL, release_dir TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, page_id TEXT, detail TEXT, created_at TEXT NOT NULL);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_audit_created ON audit_logs(created_at);`;
function legacy(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(legacySchema);
  db.exec("INSERT INTO pages VALUES ('id', 'title', 'slug', 'index.html', 'private', 'html', 'index.html', 'rel', '/old/path', 2, 1, 'now', 'now')");
  db.close();
}

test('new and legacy databases are versioned idempotently without changing private data', (t) => {
  const dir = temp(t);
  const file = path.join(dir, 'old.sqlite');
  legacy(file);
  for (const filename of [file, path.join(dir, 'new.sqlite')]) {
    for (let i = 0; i < 2; i++) {
      const db = openDatabase(filename);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 24);
      if (filename === file) assert.deepEqual({ ...db.prepare('SELECT access_mode, release_dir FROM pages').get() }, { access_mode: 'private', release_dir: '/old/path' });
      db.close();
    }
  }
});

test('version 20 upgrades to team audit without altering existing workspaces', t => {
  const file=path.join(temp(t),'v20.sqlite');let db=openDatabase(file);
  db.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES ('u','u@example.org','hash',1); INSERT INTO workspaces VALUES ('w','Team','team','u','now'); INSERT INTO workspace_members VALUES ('w','u','owner','now'); DROP TRIGGER api_credentials_password_change; DROP TABLE api_credentials; DROP TABLE workspace_audit; PRAGMA user_version=20;");db.close();
  db=openDatabase(file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,24);
  assert.equal(db.prepare('SELECT name FROM workspaces WHERE id=?').get('w').name,'Team');
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_audit').get().n,0);db.close();
});

test('version 21 audit events survive adding application references', t => {
  const file=path.join(temp(t),'v21.sqlite');let db=openDatabase(file);
  db.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES ('u','u@example.org','hash',1); INSERT INTO workspaces VALUES ('w','Team','team','u','now'); INSERT INTO workspace_audit(workspace_id,actor_id,action,created_at) VALUES ('w','u','workspace.created','now'); DROP TRIGGER api_credentials_password_change; DROP TABLE api_credentials; ALTER TABLE workspace_audit DROP COLUMN resource_id; ALTER TABLE workspace_audit DROP COLUMN page_id; PRAGMA user_version=21;");db.close();
  db=openDatabase(file);const event=db.prepare('SELECT action,page_id,resource_id FROM workspace_audit').get();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,24);assert.equal(event.action,'workspace.created');assert.equal(event.page_id,null);assert.equal(event.resource_id,null);db.close();
});

test('unknown or partial schemas and future versions fail without changes', (t) => {
  const dir = temp(t);
  for (const [name, sql] of [['partial', 'CREATE TABLE pages (id TEXT);'], ['future', 'PRAGMA user_version = 99;']]) {
    const file = path.join(dir, name + '.sqlite');
    const db = new DatabaseSync(file); db.exec(sql); db.close();
    assert.throws(() => openDatabase(file), /schema|version/i);
    const after = new DatabaseSync(file);
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, name === 'future' ? 99 : 0);
    assert.equal(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'sessions'").get().n, 0);
    after.close();
  }
});

test('interrupted migration rolls back and an offline backup can be restored', (t) => {
  const dir = temp(t), source = path.join(dir, 'source.sqlite'), backup = path.join(dir, 'backup.sqlite'), restored = path.join(dir, 'restored.sqlite');
  legacy(source);
  fs.copyFileSync(source, backup);
  const script = `import { DatabaseSync } from 'node:sqlite'; import { runMigrations } from './server/migrations.js'; const db = new DatabaseSync(process.argv[1]); runMigrations(db, [{version: 1, apply(db) { db.exec('CREATE TABLE interrupted (id INTEGER)'); process.exit(23); }}]);`;
  const child = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', '--input-type=module', '-e', script, source], { cwd: process.cwd() });
  assert.equal(child.status, 23, child.stderr.toString());
  const interrupted = new DatabaseSync(source);
  assert.equal(interrupted.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(interrupted.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='interrupted'").get().n, 0);
  interrupted.close();
  fs.copyFileSync(backup, restored);
  const db = openDatabase(restored);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('SELECT access_mode FROM pages').get().access_mode, 'private');
  db.close();
});

test('migration waits for an older writer, then concurrent starters serialize', async (t) => {
  const { spawn } = await import('node:child_process');
  const dir = temp(t), file = path.join(dir, 'shared.sqlite');
  legacy(file);
  const writer = new DatabaseSync(file);
  writer.exec("BEGIN IMMEDIATE; UPDATE pages SET title = 'committed by old writer'");
  const script = `import { openDatabase } from './server/database.js'; const db = openDatabase(process.argv[1]); console.log(db.prepare('PRAGMA user_version').get().user_version); db.close();`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--input-type=module', '-e', script, file], { cwd: process.cwd() });
    let out = '', err = '';
    child.stdout.on('data', chunk => out += chunk);
    child.stderr.on('data', chunk => err += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, out, err }));
  });
  const children = [run(), run(), run()];
  await new Promise(resolve => setTimeout(resolve, 400));
  writer.exec('COMMIT'); writer.close();
  const results = await Promise.all(children);
  for (const result of results) assert.equal(result.code, 0, result.err);
  const db = openDatabase(file);
  assert.equal(db.prepare('SELECT title FROM pages').get().title, 'committed by old writer');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 24);
  db.close();
});

test('failed multi-step migration rolls back earlier steps and version', async (t) => {
  const { runMigrations } = await import('../server/migrations.js');
  const dir = temp(t), file = path.join(dir, 'failure.sqlite');
  const db = new DatabaseSync(file);
  assert.throws(() => runMigrations(db, [
    { version: 1, apply: d => d.exec('CREATE TABLE first (id INTEGER)') },
    { version: 2, apply: d => { d.exec('CREATE TABLE second (id INTEGER)'); throw new Error('injected'); } },
  ]), /injected/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('first', 'second')").get().n, 0);
  db.close();
});

