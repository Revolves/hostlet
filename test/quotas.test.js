import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { quotaMigrationSql, createQuotaService, DEFAULT_QUOTAS } from '../server/quotas.js';

function database(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE usage(workspace_id TEXT PRIMARY KEY, apps INTEGER NOT NULL, bytes INTEGER NOT NULL);');
  db.exec(quotaMigrationSql);
  db.exec("INSERT INTO workspaces VALUES ('w'),('other'); INSERT INTO usage VALUES ('w',0,0),('other',0,0)");
  return db;
}
const usage = (db, id) => db.prepare('SELECT apps, bytes FROM usage WHERE workspace_id=?').get(id);
const auth = (id, actor, action) => { if (actor !== 'admin' && !(actor === 'editor' && action !== 'manage')) throw Object.assign(new Error('denied'), {code:'FORBIDDEN'}); };
const service = (db, clock = () => 1000) => createQuotaService({db, authorize:auth, readUsage: id => usage(db,id), clock});
const fails = (fn, code) => assert.throws(fn, e => e.code === code);

test('workspace override can return to dynamic defaults with atomic audit and retained reservations',t=>{
 const db=database();t.after(()=>db.close());let defaults={maxApps:2,maxStorageBytes:40,maxUploadBytes:20},reject=false;
 const changes=[];const s=createQuotaService({db,authorize:auth,readUsage:id=>usage(db,id),defaultLimits:()=>defaults,onChange:(id,actor,action)=>{if(reject)throw Error('audit failed');changes.push({id,actor,action});}});
 assert.deepEqual(s.getConfig('w','admin'),{...defaults,source:'default'});
 fails(()=>s.update('w','admin',{maxApps:1,maxStorageBytes:10,maxUploadBytes:11}),'INVALID');
 s.update('w','admin',{maxApps:3,maxStorageBytes:60,maxUploadBytes:30});assert.equal(s.getConfig('w','admin').source,'override');
 const held=s.reserve('w','editor',{apps:1,bytes:10,ttlMs:1000});defaults={maxApps:4,maxStorageBytes:80,maxUploadBytes:40};
 fails(()=>s.clearOverride('w','editor'),'FORBIDDEN');reject=true;assert.throws(()=>s.clearOverride('w','admin'),/audit failed/);assert.equal(s.getConfig('w','admin').source,'override');
 reject=false;assert.deepEqual(s.clearOverride('w','admin'),{...defaults,source:'default'});
 assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations WHERE id=?').get(held.id).n,1);
 assert.deepEqual(changes.map(x=>x.action),['quota.override','quota.default']);
 defaults={maxApps:5,maxStorageBytes:90,maxUploadBytes:45};assert.deepEqual(s.getConfig('w','admin'),{...defaults,source:'default'});
});

test('dynamic defaults are validated and overridden only by explicit workspace settings', t => {
  const db=database(); t.after(()=>db.close());
  let defaults={maxApps:1,maxStorageBytes:20,maxUploadBytes:10};
  const s=createQuotaService({db,authorize:auth,readUsage:id=>usage(db,id),clock:()=>1000,defaultLimits:()=>defaults});
  assert.deepEqual(s.get('w','admin'),defaults);
  defaults={maxApps:2,maxStorageBytes:30,maxUploadBytes:15};
  assert.deepEqual(s.get('w','admin'),defaults);
  s.update('w','admin',{maxApps:3,maxStorageBytes:40,maxUploadBytes:20});
  defaults={maxApps:-1,maxStorageBytes:30,maxUploadBytes:15};
  assert.deepEqual(s.get('w','admin'),{maxApps:3,maxStorageBytes:40,maxUploadBytes:20});
  fails(()=>s.get('other','admin'),'INVALID');
  fails(()=>s.reserveUpload('other','editor',{apps:1,zip:false,ttlMs:100}),'INVALID');
  const asynchronous=createQuotaService({db,authorize:auth,readUsage:id=>usage(db,id),defaultLimits:()=>Promise.resolve(DEFAULT_QUOTAS)});
  assert.throws(()=>asynchronous.get('other','admin'),/synchronous/);
});

test('defaults may be read from the same database inside quota transactions', t => {
  const db=database(); t.after(()=>db.close());
  db.exec('CREATE TABLE platform_defaults(maxApps INTEGER,maxStorageBytes INTEGER,maxUploadBytes INTEGER); INSERT INTO platform_defaults VALUES (1,20,10)');
  const s=createQuotaService({db,authorize:auth,readUsage:id=>usage(db,id),defaultLimits:()=>db.prepare('SELECT * FROM platform_defaults').get()});
  assert.equal(s.get('w','admin').maxApps,1);
  db.exec('UPDATE platform_defaults SET maxApps=0');
  fails(()=>s.reserveUpload('w','editor',{apps:1,zip:false,contentLength:1,ttlMs:100}),'QUOTA_EXCEEDED');
  db.exec('UPDATE platform_defaults SET maxApps=1');
  const r=s.reserveUpload('w','editor',{apps:1,zip:false,contentLength:1,ttlMs:100});
  assert.equal(s.release('w','editor',r.id),true);
});

test('quota errors distinguish application count and storage reservations',t=>{
  const db=database();t.after(()=>db.close());const s=service(db);
  s.update('w','admin',{maxApps:0,maxStorageBytes:100,maxUploadBytes:100});
  assert.throws(()=>s.reserve('w','editor',{apps:1,bytes:1,ttlMs:100}),e=>e.code==='QUOTA_EXCEEDED'&&e.reason==='apps');
  s.update('w','admin',{maxApps:2,maxStorageBytes:10,maxUploadBytes:10});
  const reservation=s.reserve('w','editor',{apps:1,bytes:10,ttlMs:100});
  assert.throws(()=>s.reserve('w','editor',{apps:0,bytes:1,ttlMs:100}),e=>e.code==='QUOTA_EXCEEDED'&&e.reason==='storage');
  s.release('w','editor',reservation.id);
});

test('ZIP reserves available storage up to its extraction limit without blocking small workspaces',t=>{
 const db=database();t.after(()=>db.close());const s=service(db);
 s.update('w','admin',{maxApps:2,maxStorageBytes:1024,maxUploadBytes:1024});
 const r=s.reserveUpload('w','editor',{apps:1,zip:true,contentLength:500,ttlMs:100});
 assert.equal(r.bytes,1024);assert.equal(r.rawLimit,1024);
 assert.throws(()=>s.reserveUpload('w','editor',{apps:1,zip:true,ttlMs:100}),e=>e.code==='QUOTA_EXCEEDED'&&e.reason==='storage');
 s.release('w','editor',r.id);
});

test('defaults, injected authorization, updates and reduced limits preserve existing usage', t => {
  const db=database(); t.after(() => db.close()); const s=service(db);
  assert.deepEqual(s.get('w','admin'), DEFAULT_QUOTAS);
  fails(() => s.update('w','editor',{maxApps:1,maxStorageBytes:10,maxUploadBytes:10}), 'FORBIDDEN');
  db.exec("UPDATE usage SET apps=3,bytes=50 WHERE workspace_id='w'");
  s.update('w','admin',{maxApps:1,maxStorageBytes:10,maxUploadBytes:10});
  assert.deepEqual({...usage(db,'w')}, {apps:3,bytes:50});
  fails(() => s.reserve('w','editor',{apps:1,bytes:1,ttlMs:100}), 'QUOTA_EXCEEDED');
  assert.deepEqual(s.get('other','admin'), DEFAULT_QUOTAS);
});

test('usage source counts retained releases once, including the current version', t => {
  const db=database(); t.after(()=>db.close());
  db.exec("CREATE TABLE apps(id TEXT PRIMARY KEY,workspace_id TEXT,size_bytes INTEGER); CREATE TABLE releases(app_id TEXT,size_bytes INTEGER); INSERT INTO apps VALUES ('a','w',40); INSERT INTO releases VALUES ('a',40),('a',30);");
  const s=createQuotaService({db,authorize:auth,clock:()=>1000,readUsage:id=>({
    apps:db.prepare('SELECT count(*) n FROM apps WHERE workspace_id=?').get(id).n,
    bytes:db.prepare('SELECT COALESCE(sum(r.size_bytes),0) n FROM releases r JOIN apps a ON a.id=r.app_id WHERE a.workspace_id=?').get(id).n
  })});
  s.update('w','admin',{maxApps:2,maxStorageBytes:100,maxUploadBytes:100});
  const r=s.reserve('w','editor',{apps:0,bytes:30,ttlMs:100});
  fails(()=>s.reserve('w','editor',{apps:0,bytes:1,ttlMs:100}),'QUOTA_EXCEEDED');
  s.commit('w','editor',r.id,{apps:0,bytes:20},()=>db.exec("INSERT INTO releases VALUES ('a',20); UPDATE apps SET size_bytes=20 WHERE id='a'"));
  fails(()=>s.reserve('w','editor',{apps:0,bytes:11,ttlMs:100}),'QUOTA_EXCEEDED');
});

test('reservations enforce limits, release, expiry and atomic finalization', t => {
  const db=database(); t.after(() => db.close()); let now=1000; const s=service(db,()=>now);
  s.update('w','admin',{maxApps:2,maxStorageBytes:100,maxUploadBytes:60});
  const a=s.reserve('w','editor',{apps:1,bytes:60,ttlMs:100});
  fails(() => s.reserve('w','editor',{apps:1,bytes:41,ttlMs:100}), 'QUOTA_EXCEEDED');
  fails(() => s.reserve('w','editor',{apps:0,bytes:61,ttlMs:100}), 'UPLOAD_TOO_LARGE');
  fails(() => s.commit('other','editor',a.id,{apps:1,bytes:50},()=>{}), 'NOT_FOUND');
  fails(() => s.commit('w','editor',a.id,{apps:1,bytes:61},()=>{}), 'INVALID');
  assert.throws(() => s.commit('w','editor',a.id,{apps:1,bytes:50},()=>{ db.exec("UPDATE usage SET apps=1,bytes=50 WHERE workspace_id='w'"); throw Error('failed'); }), /failed/);
  assert.equal(usage(db,'w').bytes,0);
  s.commit('w','editor',a.id,{apps:1,bytes:50},()=>db.exec("UPDATE usage SET apps=1,bytes=50 WHERE workspace_id='w'"));
  fails(() => s.commit('w','editor',a.id,{apps:1,bytes:50},()=>{}), 'NOT_FOUND');
  const b=s.reserve('w','editor',{apps:0,bytes:50,ttlMs:10});
  now=1010; fails(() => s.commit('w','editor',b.id,{apps:0,bytes:1},()=>{}), 'EXPIRED');
  assert.equal(s.reap('w','admin'),1);
  const c=s.reserve('w','editor',{apps:0,bytes:50,ttlMs:10});
  assert.equal(s.release('w','editor',c.id),true); assert.equal(s.release('w','editor',c.id),false);
});

test('inputs and authoritative accounting are validated without lossy arithmetic', t => {
  const db=database(); t.after(() => db.close()); const s=service(db);
  for (const value of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null]) {
    fails(() => s.reserve('w','editor',{apps:0,bytes:value,ttlMs:1}), 'INVALID');
    fails(() => s.update('w','admin',{maxApps:value,maxStorageBytes:1,maxUploadBytes:1}), 'INVALID');
  }
  fails(() => s.reserve('w','editor',{apps:2,bytes:1,ttlMs:1}), 'INVALID');
  fails(() => s.reserve('w','editor',{apps:1,bytes:1,ttlMs:0}), 'INVALID');
  fails(() => s.get('missing','admin'), 'NOT_FOUND');
  const r=s.reserve('w','editor',{apps:1,bytes:3,ttlMs:100});
  fails(() => s.commit('w','editor',r.id,{apps:1,bytes:2},()=>{}), 'USAGE_MISMATCH');
  assert.equal(s.release('w','editor',r.id),true);
});

test('separate processes serialize competing reservations', async t => {
  const dir=mkdtempSync(join(tmpdir(),'hostlet-quotas-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'test.sqlite'); const db=database(file); service(db).update('w','admin',{maxApps:1,maxStorageBytes:10,maxUploadBytes:10}); db.close();
  const script=`import {DatabaseSync} from 'node:sqlite'; import {createQuotaService} from './server/quotas.js'; const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000'); const s=createQuotaService({db,authorize:()=>{},readUsage:id=>db.prepare('SELECT apps,bytes FROM usage WHERE workspace_id=?').get(id)}); try {s.reserve('w','a',{apps:1,bytes:10,ttlMs:60000}); console.log('ok')} catch(e){console.log(e.code||e.message)} finally{db.close()}`;
  const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--no-warnings=ExperimentalWarning','--input-type=module','-e',script,file],{cwd:process.cwd()}); let out='',err=''; p.stdout.on('data',x=>out+=x); p.stderr.on('data',x=>err+=x); p.on('error',reject); p.on('close',c=>c===0?resolve(out.trim()):reject(Error(err)));});
  assert.deepEqual((await Promise.all([run(),run()])).sort(),['QUOTA_EXCEEDED','ok']);
});
