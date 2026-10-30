import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { retentionSchema, createRetentionService } from '../server/retention.js';
import { createMailer } from '../server/mailer.js';

const DAY=86400000;
function setup(t, options={}) {
 const db=new DatabaseSync(':memory:'); db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,email_verified_at INTEGER);
 CREATE TABLE workspaces(id TEXT PRIMARY KEY);
 CREATE TABLE workspace_members(workspace_id TEXT,user_id TEXT,role TEXT,PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE workspace_pages(id TEXT PRIMARY KEY,workspace_id TEXT,updated_at TEXT);
 CREATE TABLE workspace_page_revisions(page_id TEXT PRIMARY KEY,revision INTEGER);
 CREATE TABLE platform_settings(id INTEGER PRIMARY KEY,value TEXT);
 INSERT INTO users VALUES('a','a@example.com','secret',1),('b','b@example.com','secret',1),('x','x@example.com','secret',NULL);
 INSERT INTO workspaces VALUES('w'); INSERT INTO workspace_members VALUES('w','a','owner'),('w','b','owner'),('w','x','viewer');
 INSERT INTO workspace_pages VALUES('p','w','2026-01-01T00:00:00.000Z'); INSERT INTO workspace_page_revisions VALUES('p',0);`);
 db.exec(retentionSchema); t.after(()=>db.close()); let time=Date.parse('2026-01-24T00:00:00Z'); const sent=[];
 const policy=(retention)=>db.prepare('INSERT INTO platform_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify({retention}));
 policy({mode:'inactivity',days:30,notifyBeforeDays:7});
 const sender=options.sender || (async m=>{sent.push(m); return true;});
 const deletion=options.deletePage && {execute({pageId,workspaceId,revision,validate}) {db.exec('BEGIN IMMEDIATE');try {if(!validate({db})){db.exec('COMMIT');return false;}options.deletePage({db,pageId,workspaceId,revision});db.exec('COMMIT');return true;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const service=createRetentionService({db,now:()=>time,sender,...(deletion ? {deletion} : {})});
 return {db,service,sent,policy,at:n=>{time=n;},base:Date.parse('2026-01-01T00:00:00Z')};
}

test('defaults to long term and ignores unauthorized recipients',async t=>{
 const x=setup(t); x.db.exec('DELETE FROM platform_settings'); await x.service.scan(); assert.equal(x.sent.length,0);
 x.policy({mode:'inactivity',days:30,notifyBeforeDays:7}); await x.service.scan(); assert.deepEqual(x.sent.map(m=>m.to),['a@example.com','b@example.com']);
 assert.ok(x.sent.every(m=>!JSON.stringify(m).includes('secret')));
});
test('long-term retention does not scan every application for notifications',async t=>{
 const x=setup(t);x.policy({mode:'long-term',days:null,notifyBeforeDays:null});
 const db={prepare(sql){if(sql.startsWith('SELECT id FROM workspace_pages'))throw Error('unexpected page scan');return x.db.prepare(sql);},exec:sql=>x.db.exec(sql)};
 const service=createRetentionService({db,sender:async()=>true,now:()=>x.base+100*DAY});
 assert.deepEqual(await service.notify(),{deliveryFailures:0,blockedPages:0});
});
test('a zero-day notice policy fails closed before sending or deleting',async t=>{
 const x=setup(t);x.policy({mode:'inactivity',days:30,notifyBeforeDays:0});x.at(x.base+100*DAY);
 await assert.rejects(x.service.scan(),/Invalid retention settings/);
 assert.equal(x.sent.length,0);assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
});
test('SMTP rejection leaves the owner unnotified and a later successful send is recorded',async t=>{
 const x=setup(t); const id='w-'+'a'.repeat(32);
 x.db.prepare('UPDATE workspace_pages SET id=? WHERE id=?').run(id,'p');
 x.db.prepare('UPDATE workspace_page_revisions SET page_id=? WHERE page_id=?').run(id,'p');
 let accepted=false,calls=0;
 const mailer=createMailer({host:'smtp.example.com',port:587,security:'starttls',from:'Hostlet <mail@example.com>',adminOrigin:'https://admin.example.com'},{createTransport:()=>({sendMail:async m=>{calls++;return accepted?{accepted:[m.to],rejected:[]}:{accepted:[],rejected:[m.to]};}})});
 const service=createRetentionService({db:x.db,now:()=>x.base+23*DAY,sender:mailer.sendRetention});
 assert.deepEqual(await service.scan(),{deliveryFailures:1,blockedPages:0,deletionFailures:0});
 assert.equal(x.db.prepare('SELECT count(*) n FROM retention_deliveries WHERE sent_at IS NOT NULL').get().n,0);
 accepted=true;assert.deepEqual(await service.scan(),{deliveryFailures:0,blockedPages:0,deletionFailures:0});
 assert.equal(x.db.prepare('SELECT count(*) n FROM retention_deliveries WHERE sent_at IS NOT NULL').get().n,2);
 assert.equal(calls,3);
});
test('retry failed delivery and keep a full notice period',async t=>{
 let fail=true; const sent=[]; const x=setup(t,{sender:async m=>{sent.push(m);if(m.to==='b@example.com'&&fail) throw Error('sensitive');return true;}});
 await x.service.scan(); x.at(x.base+30*DAY); await x.service.scan(); assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
 fail=false; await x.service.scan(); assert.equal(sent.filter(m=>m.to==='a@example.com').length,1); assert.equal(sent.at(-1).idempotencyKey,sent.at(-2).idempotencyKey);
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
});
test('state changes invalidate notices, including switch back',async t=>{
 const x=setup(t); await x.service.scan(); x.policy({mode:'long-term',days:null,notifyBeforeDays:null}); x.policy({mode:'inactivity',days:30,notifyBeforeDays:7}); await x.service.scan(); assert.equal(x.sent.length,4);
 x.db.exec("UPDATE workspace_pages SET updated_at='2026-01-24T00:00:00.000Z' WHERE id='p'"); x.at(x.base+30*DAY); await x.service.scan(); assert.equal(x.sent.length,4);
 x.at(x.base+46*DAY); await x.service.scan(); assert.equal(x.sent.length,6);
 x.db.exec("UPDATE workspace_members SET role='viewer' WHERE user_id='b'"); await x.service.scan(); assert.equal(x.sent.length,7);
});
test('deletion requires validated transaction and handles failure',async t=>{
 let fail=true; const x=setup(t,{deletePage:({db,pageId})=>{db.prepare('DELETE FROM workspace_pages WHERE id=?').run(pageId);if(fail) throw Error('failure');}});
 await x.service.scan(); x.at(x.base+30*DAY); await x.service.scan(); assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
 fail=false; await x.service.scan(); assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
});
test('notifications can finish outside maintenance before a separate cleanup pass',async t=>{
 let deleted=0;const x=setup(t,{deletePage:({db,pageId})=>{deleted++;db.prepare('DELETE FROM workspace_pages WHERE id=?').run(pageId);}});
 assert.deepEqual(await x.service.notify(),{deliveryFailures:0,blockedPages:0});
 x.at(x.base+30*DAY);assert.deepEqual(await x.service.notify(),{deliveryFailures:0,blockedPages:0});
 assert.equal(deleted,0);assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
 assert.deepEqual(x.service.cleanup(),{deletionFailures:0});assert.equal(deleted,1);
});
test('changes during delivery invalidate the batch',async t=>{
 let db; const x=setup(t,{sender:async()=>{db.exec("UPDATE workspace_page_revisions SET revision=revision+1 WHERE page_id='p'");return true;}});db=x.db;
 await x.service.scan(); x.at(x.base+40*DAY); await x.service.scan(); assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
});
test('unverified owner blocks cleanup and notice',async t=>{
 const x=setup(t); x.db.exec("UPDATE users SET email_verified_at=NULL WHERE id='b'");
 const result=await x.service.scan();assert.equal(result.blockedPages,1);assert.equal(x.sent.length,0);
 x.db.exec("UPDATE users SET email_verified_at=1 WHERE id='b'");const retried=await x.service.scan();assert.equal(retried.blockedPages,0);assert.equal(x.sent.length,2);
});

test('blocked application diagnostics are bounded, private and distinguish owners from metadata',t=>{
 const x=setup(t);x.db.exec("UPDATE users SET email_verified_at=NULL WHERE id='b'");
 for(let i=0;i<205;i++){const id=`p${String(i).padStart(3,'0')}`;x.db.prepare('INSERT INTO workspace_pages VALUES (?,?,?)').run(id,'w','2026-01-01T00:00:00.000Z');x.db.prepare('INSERT INTO workspace_page_revisions VALUES (?,0)').run(id);}
 x.db.exec("UPDATE workspace_pages SET updated_at='invalid' WHERE id='p000'");
 const first=x.service.listBlocked();assert.equal(first.issues.length,200);assert.ok(first.nextCursor);
 assert.deepEqual(first.issues.find(item=>item.pageId==='p000'),{pageId:'p000',workspaceId:'w',reason:'metadata'});
 const second=x.service.listBlocked(first.nextCursor);assert.equal(first.issues.length+second.issues.length,206);assert.equal(second.nextCursor,null);
 assert.ok(first.issues.some(item=>item.reason==='owners'));
 assert.ok(!JSON.stringify(first).includes('example.com'));
 assert.throws(()=>x.service.listBlocked('../invalid'),/cursor/i);
 x.policy({mode:'long-term',days:null,notifyBeforeDays:null});assert.deepEqual(x.service.listBlocked(),{issues:[],nextCursor:null});
});

test('cleanup waits seven days after late delivery and default adapter never deletes',async t=>{
 let deletes=0; const x=setup(t,{deletePage:({db,pageId})=>{deletes++;db.prepare('DELETE FROM workspace_pages WHERE id=?').run(pageId);}});
 x.at(x.base+40*DAY); await x.service.scan(); assert.equal(deletes,0); assert.equal(x.sent[0].deleteAfter,x.base+47*DAY);
 x.at(x.base+47*DAY); await x.service.scan(); assert.equal(deletes,1);
 const y=setup(t); await y.service.scan(); y.at(y.base+100*DAY); await y.service.scan(); assert.equal(y.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
});
test('changed revision while sending prevents cleanup even with deletion adapter',async t=>{
 let db,deleteCalls=0;const x=setup(t,{sender:async()=>{db.exec("UPDATE workspace_page_revisions SET revision=revision+1 WHERE page_id='p'");return true;},deletePage:()=>{deleteCalls++;}}); db=x.db;
 x.at(x.base+100*DAY); await x.service.scan(); assert.equal(deleteCalls,0);
});
test('failure reports are sanitized and persistent retry keys survive service recreation',async t=>{
 let key; const x=setup(t,{sender:async m=>{key=m.idempotencyKey;throw Error('token-password');}});
 assert.deepEqual(await x.service.scan(),{deliveryFailures:1,blockedPages:0,deletionFailures:0});
 const again=createRetentionService({db:x.db,now:()=>x.base+23*DAY,sender:async m=>{assert.equal(m.idempotencyKey,key);return false;}});
 assert.deepEqual(await again.scan(),{deliveryFailures:1,blockedPages:0,deletionFailures:0});
});

test('overlapping scans do not concurrently claim the same owner',async t=>{
 let release; let started; const gate=new Promise(r=>release=r); const ready=new Promise(r=>started=r); const calls=[];
 const x=setup(t,{sender:async m=>{calls.push(m);if(m.to==='a@example.com'){started();await gate;}return true;}});
 const first=x.service.scan(); await ready; await x.service.scan(); release(); await first;
 assert.equal(calls.filter(m=>m.to==='a@example.com').length,1); assert.equal(calls.filter(m=>m.to==='b@example.com').length,1);
});
test('incomplete notifications prevent deletion and changes to membership force new notice',async t=>{
 let deletes=0;const x=setup(t,{sender:async m=>m.to!=='b@example.com',deletePage:()=>{deletes++;}});
 await x.service.scan();x.at(x.base+90*DAY);await x.service.scan();assert.equal(deletes,0);
 x.db.exec("UPDATE workspace_members SET role='viewer' WHERE user_id='b'");await x.service.scan();assert.equal(deletes,0);
});
