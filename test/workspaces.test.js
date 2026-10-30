import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { workspaceSchema, createWorkspaceService } from '../server/workspaces.js';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  db.exec(workspaceSchema);
  for (const id of ['a','b','c','d']) db.prepare('INSERT INTO users VALUES (?,?)').run(id, `${id}@example.org`);
  t.after(() => db.close());
  return { db, s: createWorkspaceService(db) };
}
const denied = fn => assert.throws(fn, e => e.code === 'FORBIDDEN');
const fails = (fn, code) => assert.throws(fn, e => e.code === code);

test('members may leave teams, but the last owner and personal-space owner cannot leave', t => {
  const {db,s}=setup(t),team=s.createWorkspace('a',{type:'team',name:'Team'}),personal=s.createWorkspace('b',{type:'personal',name:'Personal'});
  const token=s.resetJoinLink(team.id,'a'),application=s.submitJoinRequest(token,'b');
  s.approveJoinRequest(team.id,'a',application.id,'viewer');
  fails(()=>s.leave(team.id,'a'),'LAST_OWNER');
  fails(()=>s.leave(personal.id,'b'),'INVALID');
  denied(()=>s.leave(team.id,'c'));
  db.exec("CREATE TRIGGER deny_leave_audit BEFORE INSERT ON workspace_audit WHEN NEW.action='member.left' BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>s.leave(team.id,'b'));assert.equal(s.authorize(team.id,'b','view'),'viewer');
  db.exec('DROP TRIGGER deny_leave_audit');s.leave(team.id,'b');denied(()=>s.authorize(team.id,'b','view'));
  const event=s.listAudit(team.id,'a')[0];assert.equal(event.action,'member.left');assert.equal(event.actorId,'b');assert.equal(event.role,'viewer');
  const retry=s.submitJoinRequest(token,'b');s.approveJoinRequest(team.id,'a',retry.id,'owner');s.leave(team.id,'a');
  assert.equal(s.authorize(team.id,'b','manage'),'owner');fails(()=>s.leave(team.id,'b'),'LAST_OWNER');
});

test('team membership decisions and join-link changes are audited atomically and privately', t => {
  const {db,s}=setup(t);
  const team=s.createWorkspace('a',{type:'team',name:'Team'});
  const token=s.resetJoinLink(team.id,'a');
  const request=s.submitJoinRequest(token,'b');
  s.approveJoinRequest(team.id,'a',request.id,'viewer');
  s.changeRole(team.id,'a','b','editor');
  s.removeMember(team.id,'a','b');
  s.revokeJoinLink(team.id,'a');
  const events=s.listAudit(team.id,'a');
  assert.deepEqual(events.map(e=>e.action),['join_link.revoked','member.removed','member.role_changed','join_request.approved','join_request.submitted','join_link.created','workspace.created']);
  assert.ok(!JSON.stringify(events).includes(token));
  denied(()=>s.listAudit(team.id,'b'));
  for(let i=0;i<110;i++)s.resetJoinLink(team.id,'a');
  const first=s.listAudit(team.id,'a'),second=s.listAudit(team.id,'a',first.at(-1).id);
  assert.equal(first.length,100);assert.equal(new Set([...first,...second].map(e=>e.id)).size,117);
  fails(()=>s.listAudit(team.id,'a',0),'INVALID');
  const previousHash=db.prepare('SELECT token_hash FROM workspace_join_links WHERE workspace_id=?').get(team.id).token_hash;
  db.exec("CREATE TRIGGER reject_workspace_audit BEFORE INSERT ON workspace_audit BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>s.resetJoinLink(team.id,'a'));
  assert.equal(db.prepare('SELECT token_hash FROM workspace_join_links WHERE workspace_id=?').get(team.id).token_hash,previousHash);
});

test('personal space and role authorization are isolated and current', t => {
  const { s } = setup(t);
  const personal = s.createWorkspace('a', { type: 'personal', name: 'Personal' });
  fails(() => s.createWorkspace('a', { type: 'personal', name: 'Again' }), 'CONFLICT');
  denied(() => s.authorize(personal.id, 'b', 'view'));
  fails(() => s.resetJoinLink(personal.id, 'a'), 'INVALID');
  const team = s.createWorkspace('a', { type: 'team', name: 'Team' });
  const token = s.resetJoinLink(team.id, 'a');
  const req = s.submitJoinRequest(token, 'b');
  denied(() => s.authorize(team.id, 'b', 'view'));
  s.approveJoinRequest(team.id, 'a', req.id, 'viewer');
  assert.equal(s.authorize(team.id, 'b', 'view'), 'viewer');
  denied(() => s.authorize(team.id, 'b', 'edit'));
  s.changeRole(team.id, 'a', 'b', 'editor');
  assert.equal(s.authorize(team.id, 'b', 'edit'), 'editor');
  denied(() => s.authorize(team.id, 'b', 'manage'));
  s.removeMember(team.id, 'a', 'b');
  denied(() => s.authorize(team.id, 'b', 'view'));
  denied(() => s.authorize(personal.id, 'b', 'view'));
});

test('links are hashed, revoked and reset; requests are scoped and single decision', t => {
  const { db, s } = setup(t);
  const a = s.createWorkspace('a', { type: 'team', name: 'A' });
  const b = s.createWorkspace('b', { type: 'team', name: 'B' });
  const old = s.resetJoinLink(a.id, 'a');
  const row = db.prepare('SELECT * FROM workspace_join_links').get();
  assert.ok(!Object.values(row).includes(old));
  const request = s.submitJoinRequest(old, 'c');
  fails(() => s.submitJoinRequest(old, 'c'), 'CONFLICT');
  const fresh = s.resetJoinLink(a.id, 'a');
  fails(() => s.submitJoinRequest(old, 'd'), 'NOT_FOUND');
  denied(() => s.approveJoinRequest(a.id, 'b', request.id, 'viewer'));
  fails(() => s.approveJoinRequest(b.id, 'b', request.id, 'viewer'), 'NOT_FOUND');
  s.rejectJoinRequest(a.id, 'a', request.id);
  fails(() => s.approveJoinRequest(a.id, 'a', request.id, 'viewer'), 'CONFLICT');
  denied(() => s.authorize(a.id, 'c', 'view'));
  const again = s.submitJoinRequest(fresh, 'c');
  s.approveJoinRequest(a.id, 'a', again.id, 'editor');
  s.revokeJoinLink(a.id, 'a');
  fails(() => s.submitJoinRequest(fresh, 'd'), 'NOT_FOUND');
  fails(() => s.submitJoinRequest(fresh, 'missing'), 'NOT_FOUND');
});

test('last owner protected; owners may transfer and member operations are authorized', t => {
  const { s } = setup(t);
  const w = s.createWorkspace('a', { type: 'team', name: 'T' });
  fails(() => s.removeMember(w.id, 'a', 'a'), 'LAST_OWNER');
  fails(() => s.changeRole(w.id, 'a', 'a', 'viewer'), 'LAST_OWNER');
  const r = s.submitJoinRequest(s.resetJoinLink(w.id, 'a'), 'b');
  s.approveJoinRequest(w.id, 'a', r.id, 'owner');
  s.changeRole(w.id, 'a', 'a', 'viewer');
  denied(() => s.removeMember(w.id, 'a', 'b'));
  fails(() => s.removeMember(w.id, 'b', 'b'), 'LAST_OWNER');
  fails(() => s.changeRole(w.id, 'b', 'a', 'bogus'), 'INVALID');
  fails(() => s.authorize(w.id, 'a', 'unknown'), 'INVALID');
  s.removeMember(w.id, 'b', 'a');
  denied(() => s.authorize(w.id, 'a', 'view'));
});

test('schema uniqueness and transactional failures leave no partial state', t => {
  const { db, s } = setup(t);
  const w = s.createWorkspace('a', { type: 'team', name: 'T' });
  const token = s.resetJoinLink(w.id, 'a');
  const r = s.submitJoinRequest(token, 'b');
  fails(() => s.approveJoinRequest(w.id, 'a', r.id, 'invalid'), 'INVALID');
  assert.equal(db.prepare('SELECT status FROM workspace_join_requests WHERE id=?').get(r.id).status, 'pending');
  s.approveJoinRequest(w.id, 'a', r.id, 'viewer');
  fails(() => s.approveJoinRequest(w.id, 'a', r.id, 'viewer'), 'CONFLICT');
  fails(() => s.submitJoinRequest(token, 'b'), 'CONFLICT');
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_members WHERE workspace_id=? AND user_id=?').get(w.id, 'b').n, 1);
  fails(() => s.createWorkspace('missing', { type: 'team', name: 'T' }), 'NOT_FOUND');
});
test('workspace and owner-only request/member lists respect membership', t => {
  const { s } = setup(t);
  const w = s.createWorkspace('a', { type: 'team', name: 'T' });
  const req = s.submitJoinRequest(s.resetJoinLink(w.id, 'a'), 'b');
  assert.deepEqual(s.listWorkspaces('b'), []);
  assert.equal(s.listRequests(w.id, 'a')[0].id, req.id);
  assert.equal(s.listRequests(w.id, 'a')[0].email, 'b@example.org');
  denied(() => s.listRequests(w.id, 'b'));
  s.approveJoinRequest(w.id, 'a', req.id, 'viewer');
  assert.equal(s.listWorkspaces('b')[0].role, 'viewer');
  assert.equal(s.listMembers(w.id, 'b').length, 2);
  assert.equal(s.listMembers(w.id, 'b').find(member => member.userId === 'a').email, 'a@example.org');
  denied(() => s.listRequests(w.id, 'b'));
  s.removeMember(w.id, 'a', 'b');
  assert.deepEqual(s.listWorkspaces('b'), []);
  denied(() => s.listMembers(w.id, 'b'));
});

test('concurrent owner departures serialize and preserve an owner', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'hostlet-workspaces-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'test.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY);'); db.exec(workspaceSchema);
  for (const id of ['a', 'b']) db.prepare('INSERT INTO users VALUES (?)').run(id);
  const s = createWorkspaceService(db), w = s.createWorkspace('a', {type:'team',name:'T'});
  const r = s.submitJoinRequest(s.resetJoinLink(w.id, 'a'), 'b'); s.approveJoinRequest(w.id, 'a', r.id, 'owner'); db.close();
  const script = `import {DatabaseSync} from 'node:sqlite'; import {createWorkspaceService} from './server/workspaces.js'; const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000'); try {createWorkspaceService(db).removeMember(process.argv[2],process.argv[3],process.argv[3]); console.log('ok')} catch(e) {console.log(e.code || e.message)} finally {db.close()}`;
  const run = actor => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--input-type=module', '-e', script, file, w.id, actor], {cwd:process.cwd()});
    let out='', err=''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
  });
  const results = await Promise.all([run('a'),run('b')]);
  assert.deepEqual(results.sort(), ['LAST_OWNER','ok']);
  const check = new DatabaseSync(file);
  assert.equal(check.prepare("SELECT count(*) n FROM workspace_members WHERE workspace_id=? AND role='owner'").get(w.id).n, 1);
  check.close();
});

test('approval rolls back membership when request update fails', t => {
  const { db, s } = setup(t);
  const w = s.createWorkspace('a', { type: 'team', name: 'T' });
  const r = s.submitJoinRequest(s.resetJoinLink(w.id, 'a'), 'b');
  db.exec("CREATE TRIGGER fail_decision BEFORE UPDATE ON workspace_join_requests BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  assert.throws(() => s.approveJoinRequest(w.id, 'a', r.id, 'editor'), /injected failure/);
  denied(() => s.authorize(w.id, 'b', 'view'));
  assert.equal(db.prepare('SELECT status FROM workspace_join_requests WHERE id=?').get(r.id).status, 'pending');
});
