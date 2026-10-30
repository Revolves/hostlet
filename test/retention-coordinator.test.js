import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMaintenanceGate } from '../server/maintenance.js';
import { createRetentionCoordinator } from '../server/retention-coordinator.js';
import { openDatabase } from '../server/database.js';
import { createRetentionService } from '../server/retention.js';
import { createWorkspaceDeletionService } from '../server/workspace-deletion.js';

test('notification runs while requests remain available, cleanup runs exclusively',async()=>{
 const gate=createMaintenanceGate();let notifyStarted,resume;
 const started=new Promise(resolve=>{notifyStarted=resolve;}), wait=new Promise(resolve=>{resume=resolve;});let recovered=0,cleaned=0;
 const coordinator=createRetentionCoordinator({gate,deletion:{recover(){assert.equal(gate.isQuiescent(),true);recovered++;}},service:{async notify(){notifyStarted();await wait;return {deliveryFailures:0};},cleanup(){assert.equal(gate.isQuiescent(),true);cleaned++;return {deletionFailures:0};}}});
 const work=coordinator.runOnce();await started;
 const res=new EventEmitter();let allowed=false;gate.middleware({},res,()=>{allowed=true;});assert.equal(allowed,true);
 res.emit('finish');resume();
 await work;
 assert.equal(recovered,2);assert.equal(cleaned,1);
});

test('a scan with no eligible pages or recovery work does not block active requests',async()=>{
 const gate=createMaintenanceGate(),res=new EventEmitter();gate.middleware({},res,()=>{});
 const coordinator=createRetentionCoordinator({gate,deletion:{hasPending:()=>false,recover(){assert.fail('nothing to recover');}},service:{async notify(){return {deliveryFailures:0};},hasCleanupWork:()=>false,cleanup(){assert.fail('nothing to clean');}}});
 const work=coordinator.runOnce();await Promise.resolve();await Promise.resolve();
 const probe=new EventEmitter();probe.set=()=>probe;probe.status=code=>{probe.code=code;return probe;};probe.send=()=>probe;
 let allowed=false;gate.middleware({},probe,()=>{allowed=true;});
 if(allowed) probe.emit('finish');res.emit('finish');
 const result=await work;assert.equal(allowed,true);assert.deepEqual(result,{deliveryFailures:0,deletionFailures:0});
});

test('a pending deletion journal still requires exclusive recovery when no pages are eligible',async()=>{
 const gate=createMaintenanceGate();let recovered=0;
 const coordinator=createRetentionCoordinator({gate,deletion:{hasPending:()=>true,recover(){assert.equal(gate.isQuiescent(),true);recovered++;}},service:{async notify(){return {deliveryFailures:0};},hasCleanupWork:()=>false,cleanup(){return {deletionFailures:0};}}});
 assert.deepEqual(await coordinator.runOnce(),{deliveryFailures:0,deletionFailures:0});assert.equal(recovered,2);
});

test('unrecoverable deletion state keeps the maintenance gate closed',async()=>{
 const gate=createMaintenanceGate();let calls=0;
 const coordinator=createRetentionCoordinator({gate,deletion:{recover(){if(++calls===2)throw Error('recovery failed');}},service:{async notify(){return {deliveryFailures:0};},cleanup(){return {deletionFailures:1};}}});
 await assert.rejects(coordinator.runOnce(),/recovery failed/);
 const res={set(){return this;},status(code){this.code=code;return this;},send(){return this;}};
 gate.middleware({},res,()=>assert.fail('maintenance reopened'));assert.equal(res.code,503);
});

test('real deletion waits for accepted notice and the entire notice period',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-retention-coordinator-'));
 const db=openDatabase(':memory:');t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const page='w-'+'a'.repeat(32), timestamp='2026-01-01T00:00:00.000Z', day=86400000, start=Date.parse(timestamp);
 db.exec("INSERT INTO users(id,email,password_hash,email_verified_at,created_at) VALUES ('u','u@example.org','hash',1,0); INSERT INTO workspaces VALUES ('s','Space','personal','u','now'); INSERT INTO workspace_members VALUES ('s','u','owner','now')");
 db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(page);
 db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(page,'s','u','title','private',page,'1-aaaaaaaaaa','index.html','html','index.html',1,1,timestamp,timestamp);
 db.prepare('INSERT INTO workspace_page_revisions VALUES (?,0)').run(page);
 db.prepare('INSERT INTO workspace_page_releases VALUES (?,?,?,?,?,?,?,?)').run(page,'1-aaaaaaaaaa','index.html','html','index.html',1,1,timestamp);
 db.prepare('INSERT INTO platform_settings VALUES(1,?)').run(JSON.stringify({retention:{mode:'inactivity',days:30,notifyBeforeDays:7}}));
 const dir=path.join(root,'sites',page,'releases','1-aaaaaaaaaa');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'x');
 const gate=createMaintenanceGate();let now=start+23*day,accept=false;
 const deletion=createWorkspaceDeletionService({db,storageRoot:root,assertQuiescent:gate.isQuiescent});
 const service=createRetentionService({db,now:()=>now,sender:async()=>accept,deletion});
 const coordinator=createRetentionCoordinator({service,gate,deletion});
 const active=new EventEmitter();gate.middleware({},active,()=>{});
 const firstScan=coordinator.runOnce();await new Promise(resolve=>setImmediate(resolve));
 const probe=new EventEmitter();probe.set=()=>probe;probe.status=()=>probe;probe.send=()=>probe;
 let accepted=false;gate.middleware({},probe,()=>{accepted=true;});if(accepted)probe.emit('finish');active.emit('finish');
 assert.deepEqual(await firstScan,{deliveryFailures:1,blockedPages:0,deletionFailures:0});assert.equal(accepted,true);
 now=start+30*day;accept=true;await coordinator.runOnce();assert.ok(fs.existsSync(dir));
 now=start+37*day;await coordinator.runOnce();assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);assert.equal(fs.existsSync(dir),false);
});
