import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { workspaceSchema, createWorkspaceService } from '../server/workspaces.js';
import { createWorkspaceRouter } from '../server/workspace-router.js';

async function setup(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  db.exec(workspaceSchema);
  for (const id of ['owner', 'editor', 'viewer', 'outsider']) db.prepare('INSERT INTO users VALUES (?,?)').run(id, `${id}@example.org`);
  const app = express();
  app.use(express.json());
  const requireUser = (req, res, next) => {
    if (!req.get('x-test-user')) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: req.get('x-test-user') }; next();
  };
  app.use('/api/workspaces', createWorkspaceRouter({ service: createWorkspaceService(db), requireUser, ...options }));
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject);
  });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const call = async (user, method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/workspaces${path}`, {
      method, headers: { ...(user ? { 'x-test-user': user } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  return { db, call };
}

test('HTTP workspace membership, owner decisions and immediate permission removal', async t => {
  const { db, call } = await setup(t);
  assert.equal((await call(null, 'GET', '/')).status, 401);
  let r = await call('owner', 'POST', '/', { type: 'team', name: 'Team', actor: 'outsider' });
  assert.equal(r.status, 201); assert.equal(r.body.createdBy, 'owner');
  const id = r.body.id, base = `/${id}`;
  assert.equal((await call('outsider', 'GET', `${base}/members`)).status, 403);
  r = await call('owner', 'POST', `${base}/join-link`);
  assert.equal(r.status, 201); const token = r.body.token;
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const hash = db.prepare('SELECT token_hash FROM workspace_join_links').get().token_hash;
  assert.ok(!JSON.stringify(r.body).includes(hash));
  for (const user of ['editor', 'viewer']) {
    r = await call(user, 'POST', '/join-requests', { token, actor: 'owner' });
    assert.equal(r.status, 201); assert.equal(r.body.userId, user);
    assert.equal((await call(user, 'GET', `${base}/members`)).status, 403);
    assert.equal((await call(user, 'POST', `${base}/join-requests/${r.body.id}/approve`, { role: 'owner' })).status, 403);
    assert.equal((await call('owner', 'POST', `${base}/join-requests/${r.body.id}/approve`, { role: user })).status, 204);
  }
  for (const user of ['editor', 'viewer']) {
    assert.equal((await call(user, 'GET', `${base}/members`)).status, 200);
    assert.equal((await call(user, 'GET', `${base}/join-requests`)).status, 403);
    assert.equal((await call(user, 'POST', `${base}/join-link`)).status, 403);
    assert.equal((await call(user, 'PATCH', `${base}/members/owner`, { role: 'viewer', actor: 'owner' })).status, 403);
  }
  assert.equal((await call('owner', 'GET', `${base}/join-requests`)).body.length, 2);
  assert.equal((await call('owner', 'PATCH', `${base}/members/viewer`, { role: 'editor' })).status, 204);
  assert.equal((await call('viewer', 'GET', '/')).body[0].role, 'editor');
  assert.equal((await call('owner', 'DELETE', `${base}/members/viewer`)).status, 204);
  assert.deepEqual((await call('viewer', 'GET', '/')).body, []);
  assert.equal((await call('viewer', 'GET', `${base}/members`)).status, 403);
  assert.equal((await call('owner', 'DELETE', `${base}/members/owner`)).body.code, 'LAST_OWNER');
  r = await call('outsider', 'POST', '/join-requests', { token });
  assert.equal((await call('owner', 'POST', `${base}/join-requests/${r.body.id}/reject`)).status, 204);
  assert.equal((await call('owner', 'POST', `${base}/join-requests/${r.body.id}/approve`, { role: 'viewer' })).status, 409);
  r = await call('owner', 'POST', `${base}/join-link`);
  assert.notEqual(r.body.token, token);
  assert.equal((await call('outsider', 'POST', '/join-requests', { token })).status, 404);
  const freshToken = r.body.token;
  assert.equal((await call('owner', 'DELETE', `${base}/join-link`)).status, 204);
  assert.equal((await call('outsider', 'POST', '/join-requests', { token: freshToken })).status, 404);
  assert.equal((await call('owner', 'POST', '/', { type: 'bogus', name: 'x' })).status, 400);
});

test('leave uses authenticated identity and preserves the last owner',async t=>{
  const {call}=await setup(t);
  const team=(await call('owner','POST','/',{type:'team',name:'Team'})).body;
  const base=`/${team.id}`,token=(await call('owner','POST',`${base}/join-link`)).body.token;
  const req=(await call('viewer','POST','/join-requests',{token})).body;
  await call('owner','POST',`${base}/join-requests/${req.id}/approve`,{role:'viewer'});
  assert.equal((await call('owner','POST',`${base}/leave`,{})).body.code,'LAST_OWNER');
  assert.equal((await call('outsider','POST',`${base}/leave`,{})).status,403);
  assert.equal((await call('viewer','POST',`${base}/leave`,{userId:'owner'})).status,204);
  assert.equal((await call('viewer','GET',`${base}/members`)).status,403);
  assert.equal((await call('owner','GET',`${base}/members`)).body.length,1);
  assert.equal((await call('owner','GET',`${base}/audit`)).body[0].action,'member.left');
});

test('application limiter is injectable and default limits unsuccessful attempts', async t => {
  const { call } = await setup(t);
  for (let i = 0; i < 10; i++) assert.equal((await call('outsider', 'POST', '/join-requests', { token: 'bad' })).status, 404);
  assert.equal((await call('outsider', 'POST', '/join-requests', { token: 'bad' })).status, 429);
  assert.equal((await call('viewer', 'POST', '/join-requests', { token: 'bad' })).status, 404);
});

test('injected limiter is invoked on application submission', async t => {
  let calls = 0;
  const { call } = await setup(t, { joinRequestLimiter: (_req, res) => { calls++; res.status(429).json({ code: 'RATE_LIMITED' }); } });
  assert.equal((await call('owner', 'POST', '/join-requests', { token: 'bad' })).status, 429);
  assert.equal(calls, 1);
});

test('unexpected service errors are not exposed', async t => {
  const { call } = await setup(t, { service: { listWorkspaces() { throw new Error('secret token_hash'); } } });
  const r = await call('owner', 'GET', '/');
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(r.body), /secret|token_hash/);
});
