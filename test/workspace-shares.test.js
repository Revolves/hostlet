import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { workspaceShareSchema, createWorkspaceShareService } from '../server/workspace-shares.js';
import { workspaceSchema, createWorkspaceService } from '../server/workspaces.js';
import { workspacePagesSchema } from '../server/workspace-pages.js';

function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY);
    CREATE TABLE workspace_pages(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), access_mode TEXT NOT NULL);
    INSERT INTO workspaces VALUES ('a'),('b'); INSERT INTO workspace_pages VALUES ('p','a','private'),('q','b','private');`);
  db.exec(workspaceShareSchema);
  let time = 1000000, role = 'owner', attempts = 0;
  const service = createWorkspaceShareService({ db, now: () => time,
    authorize: (workspace, actor, permission) => { if (workspace !== 'a' || actor !== 'alice' || permission !== 'edit' || !['owner','editor'].includes(role)) throw Object.assign(new Error('FORBIDDEN'), {code:'FORBIDDEN'}); },
    limitAttempt: () => ++attempts <= 3 });
  return {db, service, advance: ms => {time += ms}, role: value => {role=value}, attempts: () => attempts};
}

test('owner and editor manage metadata; permissions are rechecked', async t => {
  const {service, role} = setup(t);
  const created = await service.create('a','alice','p',{});
  assert.equal(service.list('a','alice','p')[0].id, created.id);
  assert.equal('token' in service.list('a','alice','p')[0], false);
  role('editor'); assert.equal(service.list('a','alice','p').length,1);
  role('viewer'); assert.throws(() => service.list('a','alice','p'), {code:'FORBIDDEN'});
  assert.throws(() => service.revoke('a','alice','p',created.id), {code:'FORBIDDEN'});
  await assert.rejects(service.create('a','alice','p',{}), {code:'FORBIDDEN'});
});

test('password share exchanges once and validates every resource against page, share and workspace', async t => {
  const {db, service} = setup(t);
  const share = await service.create('a','alice','p',{password:'private password'});
  const row = db.prepare('SELECT * FROM workspace_shares').get();
  assert.ok(row.password_hash.startsWith('scrypt$')); assert.ok(!row.password_hash.includes('private password'));
  assert.notEqual(row.token_hash, share.token);
  assert.equal(await service.issue('p',share.token,'wrong','client'), null);
  const ticket = await service.issue('p',share.token,'private password','client');
  assert.notEqual(db.prepare('SELECT token_hash FROM workspace_share_tickets').get().token_hash,ticket);
  assert.equal(service.exchange('q',ticket),null);
  const session = service.exchange('p',ticket);
  assert.equal(service.exchange('p',ticket),null);
  assert.notEqual(db.prepare('SELECT token_hash FROM workspace_share_sessions').get().token_hash,session.value);
  assert.ok(service.authorize('p',session.value)); assert.equal(service.authorize('q',session.value),null);
  db.prepare("UPDATE workspace_pages SET workspace_id='b' WHERE id='p'").run();
  assert.equal(service.authorize('p',session.value),null);
});

test('expiration and revocation invalidate tickets and existing sessions', async t => {
  const {service, advance} = setup(t);
  const s = await service.create('a','alice','p',{expiresAt:1005000});
  const ticket = await service.issue('p',s.token,undefined,'client');
  const session = service.exchange('p',ticket); advance(5000);
  assert.equal(service.authorize('p',session.value),null);
  assert.equal(await service.issue('p',s.token,undefined,'client'),null);
  const other = await service.create('a','alice','p',{});
  const ticket2 = await service.issue('p',other.token,undefined,'client');
  service.revoke('a','alice','p',other.id);
  assert.equal(service.exchange('p',ticket2),null);
});

test('short ticket and session lifetimes and rate limit contract', async t => {
  const {service, advance, attempts} = setup(t);
  const s = await service.create('a','alice','p',{});
  const first = await service.issue('p',s.token,undefined,'client'); advance(30000);
  assert.equal(service.exchange('p',first),null);
  const second = await service.issue('p',s.token,undefined,'client');
  const session = service.exchange('p',second); advance(300000);
  assert.equal(service.authorize('p',session.value),null);
  assert.equal(await service.issue('p','invalid',undefined,'client'),null);
  await assert.rejects(service.issue('p',s.token,undefined,'client'), {code:'RATE_LIMITED'});
  assert.equal(attempts(),4);
});

test('revocation invalidates a session immediately and other shares remain independent', async t => {
  const {service} = setup(t);
  const one=await service.create('a','alice','p',{}), two=await service.create('a','alice','p',{});
  const session=service.exchange('p',await service.issue('p',one.token,undefined,'client'));
  service.revoke('a','alice','p',one.id);
  assert.equal(service.authorize('p',session.value),null);
  assert.ok(service.exchange('p',await service.issue('p',two.token,undefined,'client')));
});

test('permissions and revocation are checked again after asynchronous password hashing', async t => {
  const {service, role} = setup(t);
  const creating=service.create('a','alice','p',{password:'password'});
  role('viewer'); await assert.rejects(creating,{code:'FORBIDDEN'}); role('owner');
  const s=await service.create('a','alice','p',{password:'password'});
  const issuing=service.issue('p',s.token,'password','client');
  service.revoke('a','alice','p',s.id);
  assert.equal(await issuing,null);
});

test('password hashes use independent salts; page and workspace access cannot be mixed', async t => {
  const {db,service} = setup(t);
  const a=await service.create('a','alice','p',{password:'same'});
  await service.create('a','alice','p',{password:'same'});
  const hashes=db.prepare('SELECT password_hash FROM workspace_shares').all().map(x=>x.password_hash);
  assert.notEqual(hashes[0],hashes[1]);
  assert.equal(await service.issue('q',a.token,'same','client'),null);
  await assert.rejects(service.create('a','alice','q',{}),{code:'NOT_FOUND'});
  assert.throws(()=>service.list('a','alice','q'),{code:'NOT_FOUND'});
  assert.throws(()=>service.revoke('a','alice','q',a.id),{code:'NOT_FOUND'});
});

test('limiter fails closed and passwords must be nonempty and bounded', async t => {
  const {db,service} = setup(t);
  assert.throws(()=>createWorkspaceShareService({db,authorize() {}}),TypeError);
  await assert.rejects(service.create('a','alice','p',{password:''}),{code:'INVALID'});
  await assert.rejects(service.create('a','alice','p',{password:'x'.repeat(1025)}),{code:'INVALID'});
  const closed=createWorkspaceShareService({db,authorize(){},limitAttempt(){ return Promise.resolve(true); }});
  await assert.rejects(closed.issue('p','invalid',undefined,'client'),{code:'RATE_LIMITED'});
});

test('composes with real workspace schemas and checks current membership', async t => {
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY);');
  db.exec(workspaceSchema); db.exec(workspacePagesSchema); db.exec(workspaceShareSchema);
  db.exec(`INSERT INTO users VALUES ('owner'),('editor'),('viewer');
    INSERT INTO workspaces VALUES ('w','Team','team','owner','now');
    INSERT INTO workspace_members VALUES ('w','owner','owner','now'),('w','editor','editor','now'),('w','viewer','viewer','now');
    INSERT INTO workspace_page_ids VALUES ('p');
    INSERT INTO workspace_pages VALUES ('p','w','owner','Title','private','p','release','index.html','html','index.html',1,1,'now','now');`);
  const service=createWorkspaceShareService({db,authorize:createWorkspaceService(db).authorize,limitAttempt:()=>true});
  const share=await service.create('w','editor','p',{});
  assert.equal(service.list('w','owner','p').length,1);
  assert.throws(()=>service.list('w','viewer','p'),{code:'FORBIDDEN'});
  db.exec("UPDATE workspace_members SET role='viewer' WHERE user_id='editor'");
  assert.throws(()=>service.revoke('w','editor','p',share.id),{code:'FORBIDDEN'});
  service.revoke('w','owner','p',share.id);
});

test('failed session creation rolls back ticket consumption', async t => {
  const {db,service}=setup(t);
  const s=await service.create('a','alice','p',{});
  const ticket=await service.issue('p',s.token,undefined,'client');
  db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON workspace_share_sessions BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>service.exchange('p',ticket),/injected/);
  db.exec('DROP TRIGGER reject_session');
  assert.ok(service.exchange('p',ticket));
});
