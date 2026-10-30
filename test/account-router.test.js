import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { accountMigrationSql, accountTokensMultiUseMigrationSql, createAccounts } from '../server/accounts.js';
import { workspaceSchema } from '../server/workspaces.js';
import { sessionSchema, createAccountSessions } from '../server/account-sessions.js';
import { createAccountRouter } from '../server/account-router.js';
import { createMaintenanceGate } from '../server/maintenance.js';

const password = 'a sufficiently long password';
async function setup(t, opts = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON'); db.exec(accountMigrationSql); db.exec(workspaceSchema); db.exec(sessionSchema); db.exec(accountTokensMultiUseMigrationSql);
  const mail = [];
  const accounts = createAccounts({ db, sender: opts.sender || (async m => mail.push(m)) });
  const sessions = createAccountSessions({ db, secure: opts.secure ?? false });
  const app = express();
  if (opts.trustProxy) app.set('trust proxy', 'loopback');
  if (opts.gate) app.use('/account', opts.gate.middleware);
  app.use('/account', createAccountRouter({ accounts, sessions, allowedOrigins: ['https://app.example'], registrationEnabled: opts.registrationEnabled ?? true, rateLimit: opts.rateLimit, deleteAccount: opts.deleteAccount }));
  app.get('/protected', sessions.requireSession, (req,res) => res.json(req.account));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body = {}, headers = {}) => fetch(base + '/account/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.example', ...headers }, body: JSON.stringify(body) });
  return { db, mail, sessions, base, post };
}
async function registerAndVerify(ctx) {
  assert.equal((await ctx.post('register', { email:'a@example.com', password })).status, 202);
  assert.equal((await ctx.post('verify', { token:ctx.mail.at(-1).token })).status, 200);
}
async function login(ctx, pass = password) {
  const response = await ctx.post('login', { email:'a@example.com', password:pass });
  return { response, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
}
async function within(promise, message) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),5000);})]); }
  finally { clearTimeout(timer); }
}
test('registration, verification, session, logout and password reset revoke every session', async t => {
  const ctx = await setup(t); await registerAndVerify(ctx);
  const a = await login(ctx); const b = await login(ctx);
  assert.equal(a.response.status, 200); assert.match(a.response.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(a.response.headers.getSetCookie()[0], /Domain=/i);
  assert.equal((await fetch(ctx.base+'/protected', {headers:{Cookie:a.cookie}})).status, 200);
  assert.ok(!JSON.stringify(ctx.db.prepare('SELECT * FROM account_sessions').all()).includes(a.cookie.split('=')[1]));
  assert.equal((await ctx.post('forgot-password', {email:'a@example.com'})).status, 202);
  assert.equal((await ctx.post('reset-password', {token:ctx.mail.at(-1).token,password:'a new lengthy password'})).status, 200);
  for (const cookie of [a.cookie,b.cookie]) assert.equal((await fetch(ctx.base+'/protected',{headers:{Cookie:cookie}})).status, 401);
  assert.equal((await login(ctx)).response.status, 401);
  const c = await login(ctx, 'a new lengthy password'); assert.equal(c.response.status, 200);
  assert.equal((await ctx.post('logout', {}, {Cookie:c.cookie})).status, 200);
  assert.equal((await fetch(ctx.base+'/protected',{headers:{Cookie:c.cookie}})).status, 401);
});
test('strict origins, registration switch, neutral recovery and login results', async t => {
  const ctx = await setup(t, {registrationEnabled:false});
  assert.equal((await ctx.post('register',{email:'a@example.com',password})).status, 403);
  assert.equal((await ctx.post('login',{email:'a@example.com',password},{Origin:'https://evil.example'})).status, 403);
  assert.equal((await ctx.post('login',{email:'a@example.com',password},{Origin:''})).status, 403);
  const a = await ctx.post('forgot-password',{email:'missing@example.com'});
  const b = await ctx.post('forgot-password',{email:'invalid'});
  assert.equal(a.status, 202); assert.deepEqual(await a.json(), await b.json());
  assert.equal((await login(ctx)).response.status, 401);
});
test('resend, single use tokens, secure cookie and rate limiting', async t => {
  const ctx = await setup(t,{secure:true, rateLimit:{limit:3,windowMs:60000}});
  assert.equal((await ctx.post('register',{email:'a@example.com',password})).status,202);
  const old = ctx.mail[0].token;
  assert.equal((await ctx.post('resend-verification',{email:'a@example.com'})).status,202);
  assert.equal((await ctx.post('verify',{token:old})).status,200);
  assert.equal((await ctx.post('verify',{token:ctx.mail[1].token})).status,400);
  const a = await login(ctx); assert.match(a.response.headers.getSetCookie()[0], /; Secure/);
  assert.equal((await login(ctx)).response.status,200);
  assert.equal((await login(ctx)).response.status,200);
  assert.equal((await login(ctx)).response.status,429);
});
test('mail failure does not reveal secrets and recovery remains neutral', async t => {
  const ctx = await setup(t,{sender:async m => { throw new Error(`secret ${m.token} ${password}`); }});
  const r = await ctx.post('register',{email:'a@example.com',password});
  const body = await r.text(); assert.equal(r.status,202); assert.ok(!body.includes(password)); assert.ok(!body.includes('secret'));
  const a = await ctx.post('resend-verification',{email:'a@example.com'});
  const b = await ctx.post('resend-verification',{email:'missing@example.com'});
  assert.equal(a.status,202); assert.equal(await a.text(),await b.text());
});

test('recovery responses do not wait for an existing account email to be delivered', async t => {
  const mail=[]; let blocked=null;
  const ctx=await setup(t,{sender:async message=>{mail.push(message);if(blocked){blocked.started();await blocked.wait;}}});
  assert.equal((await ctx.post('register',{email:'a@example.com',password})).status,202);
  for (const route of ['resend-verification','forgot-password']) {
    if(route==='forgot-password') assert.equal((await ctx.post('verify',{token:mail[0].token})).status,200);
    let start,release;const entered=new Promise(resolve=>{start=resolve;});const wait=new Promise(resolve=>{release=resolve;});blocked={started:start,wait};
    const pending=ctx.post(route,{email:'a@example.com'});
    let result;
    try { await within(entered,`${route} did not start sending`);result=await within(pending,`${route} waited for email delivery`); }
    finally { blocked=null;release(); }
    assert.equal(result.status,202);
    assert.equal((await ctx.post(route,{email:'missing@example.com'})).status,202);
  }
});

test('registration response does not wait for email delivery', async t => {
  let start,release;const entered=new Promise(resolve=>{start=resolve;});const wait=new Promise(resolve=>{release=resolve;});
  const ctx=await setup(t,{sender:async()=>{start();await wait;}});
  const pending=ctx.post('register',{email:'new@example.com',password});
  let result;try {await within(entered,'registration did not start sending');result=await within(pending,'registration waited for email delivery');}
  finally {release();}
  assert.equal(result.status,202);
});

test('maintenance waits for recovery email work after the response', async t => {
  const gate=createMaintenanceGate();const mail=[];let hold=false,release,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const ctx=await setup(t,{gate,sender:async message=>{mail.push(message);if(hold){started();await new Promise(resolve=>{release=resolve;});}}});
  assert.equal((await ctx.post('register',{email:'a@example.com',password})).status,202);
  hold=true;assert.equal((await ctx.post('resend-verification',{email:'a@example.com'})).status,202);await waiting;
  let entered=false;const maintenance=gate.runExclusive(()=>{entered=true;});
  try { assert.equal((await ctx.post('resend-verification',{email:'missing@example.com'})).status,503);assert.equal(entered,false); }
  finally { release();await maintenance; }
  assert.equal(entered,true);
});

test('failed background recovery revokes its token before maintenance proceeds', async t => {
  const gate=createMaintenanceGate();const mail=[];let fail=false,rejectSend,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const ctx=await setup(t,{gate,sender:async message=>{mail.push(message);if(fail){started();await new Promise((_,reject)=>{rejectSend=reject;});}}});
  assert.equal((await ctx.post('register',{email:'a@example.com',password})).status,202);
  assert.equal((await ctx.post('verify',{token:mail[0].token})).status,200);
  fail=true;assert.equal((await ctx.post('forgot-password',{email:'a@example.com'})).status,202);await entered;
  const drain=gate.runExclusive(()=>{});
  rejectSend(new Error('synthetic mail failure'));await drain;
  assert.equal(ctx.db.prepare("SELECT count(*) n FROM account_tokens WHERE purpose='reset'").get().n,0);
});

test('reset revocation is atomic and invalidates an in-flight authentication snapshot', async t => {
  const ctx = await setup(t); await registerAndVerify(ctx);
  const loggedIn = await login(ctx);
  const before = ctx.sessions.snapshot('a@example.com');
  const identity = ctx.sessions.find({headers:{cookie:loggedIn.cookie}});
  await ctx.post('forgot-password',{email:'a@example.com'});
  const token = ctx.mail.at(-1).token;
  ctx.db.exec("CREATE TRIGGER reject_revoke BEFORE DELETE ON account_sessions BEGIN SELECT RAISE(ABORT, 'injected'); END");
  assert.equal((await ctx.post('reset-password',{token,password:'a new lengthy password'})).status,500);
  assert.equal((await fetch(ctx.base+'/protected',{headers:{Cookie:loggedIn.cookie}})).status,200);
  ctx.db.exec('DROP TRIGGER reject_revoke');
  assert.equal((await ctx.post('reset-password',{token,password:'a new lengthy password'})).status,200);
  assert.equal(ctx.sessions.create(identity,before),null);
  assert.equal((await ctx.post('reset-password',{token,password:'another lengthy password'})).status,400);
});

test('account sessions reject legacy and duplicate cookies and expire', async t => {
  const ctx = await setup(t); await registerAndVerify(ctx);
  const {cookie} = await login(ctx);
  assert.equal((await fetch(ctx.base+'/protected',{headers:{Cookie:'hostlet_admin=abc'}})).status,401);
  assert.equal((await fetch(ctx.base+'/protected',{headers:{Cookie:`${cookie}; ${cookie}`}})).status,401);
  ctx.db.prepare('UPDATE account_sessions SET expires_at=0').run();
  assert.equal((await fetch(ctx.base+'/protected',{headers:{Cookie:cookie}})).status,401);
  assert.equal(ctx.sessions.purgeExpired(),1);
});

test('rate limits cannot be bypassed by changing route case or trailing slash', async t => {
  const ctx = await setup(t,{rateLimit:{limit:1,windowMs:60000}});
  assert.equal((await ctx.post('login',{email:'nobody@example.com',password})).status,401);
  assert.equal((await ctx.post('LOGIN/',{email:'nobody@example.com',password})).status,429);
});

test('global rate limit counts requests across account routes without blocking reads',async t=>{
  const ctx=await setup(t,{trustProxy:true,rateLimit:{limit:100,globalLimit:2,windowMs:60000}});
  assert.equal((await ctx.post('verify',{token:'bad'},{'X-Forwarded-For':'192.0.2.1'})).status,400);
  assert.equal((await ctx.post('forgot-password',{email:'invalid'},{'X-Forwarded-For':'192.0.2.2'})).status,202);
  assert.equal((await ctx.post('login',{email:'nobody@example.com',password},{'X-Forwarded-For':'192.0.2.3'})).status,429);
  assert.equal((await fetch(ctx.base+'/account/me')).status,200);
});

test('account deletion authenticates the password and runs only in an exclusive maintenance window', async t => {
  let called = null;
  let quiescent = null;
  const gate = createMaintenanceGate();
  const ctx = await setup(t, {
    gate,
    deleteAccount: async id => { called = id; quiescent = gate.isQuiescent(); },
  });
  await registerAndVerify(ctx);
  const { cookie } = await login(ctx);
  const headers = { 'Content-Type': 'application/json', Origin: 'https://app.example', Cookie: cookie };
  const wrong = await fetch(ctx.base + '/account', { method: 'DELETE', headers, body: JSON.stringify({ password: 'wrong password' }) });
  assert.equal(wrong.status, 401);
  assert.equal(called, null);
  const good = await fetch(ctx.base + '/account', { method: 'DELETE', headers, body: JSON.stringify({ password }) });
  assert.equal(good.status, 204);
  assert.ok(called);
  assert.equal(quiescent, true);
  assert.match(good.headers.get('set-cookie') || '', /hostlet_account=/);
});

test('account deletion maps last-owner and maintenance failures without deleting the session', async t => {
  const ctx = await setup(t, {
    gate: createMaintenanceGate(),
    deleteAccount: async () => { throw Object.assign(new Error('LAST_OWNER'), { code: 'LAST_OWNER' }); },
  });
  await registerAndVerify(ctx);
  const { cookie } = await login(ctx);
  const response = await fetch(ctx.base + '/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.example', Cookie: cookie },
    body: JSON.stringify({ password }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'LAST_OWNER');
  assert.equal((await fetch(ctx.base + '/protected', { headers: { Cookie: cookie } })).status, 200);
});

test('account operation concurrency is bounded until the in-flight work settles',async t=>{
  let release,started;const waiting=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{started=resolve;});
  const ctx=await setup(t,{rateLimit:{maxConcurrent:1},sender:async()=>{started();await waiting;}});
  const first=ctx.post('register',{email:'busy@example.com',password});await entered;
  let blocked;try{blocked=await ctx.post('login',{email:'nobody@example.com',password});}finally{release();}
  assert.equal((await first).status,202);assert.equal(blocked.status,429);
  assert.equal((await ctx.post('login',{email:'nobody@example.com',password})).status,401);
});
