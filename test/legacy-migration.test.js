import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { openDatabase } from '../server/database.js';
import { loadConfig } from '../server/config.js';
import { createApps } from '../server/app.js';
import { acquireInstanceLock } from '../server/instance-lock.js';
import { inspectLegacyMigration, createLegacyMigration, legacyMigrationSchema, verifyLegacyMigrationBackup } from '../server/legacy-migration.js';

function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-legacy-migration-')),db=openDatabase(path.join(root,'hostlet.sqlite'));
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_migration_journal'").get())db.exec(legacyMigrationSchema);
 const context={root,db,pages:null};t.after(()=>{context.db.close();fs.rmSync(root,{recursive:true,force:true});});
 db.exec("INSERT INTO users(id,email,password_hash,email_verified_at,created_at) VALUES ('owner','owner@example.org','hash',1,0),('other','other@example.org','hash',NULL,0); INSERT INTO workspaces VALUES ('personal','Personal','personal','owner','now'),('team','Team','team','owner','now'); INSERT INTO workspace_members VALUES ('personal','owner','owner','now'),('team','owner','owner','now')");
 const pages=[];
 for(const [id,mode] of [['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','private'],['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','public']]){
  const release='1-aaaaaaaaaa',dir=path.join(root,'storage','sites',id,'releases',release);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'hello');
  db.prepare('INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,mode,mode,'index.html',mode,'html','index.html',release,dir,5,1,'now','now',0);
  db.prepare('INSERT INTO page_releases VALUES (?,?,?,?,?,?,?,?,?)').run(id,release,dir,'index.html','html','index.html',5,1,'now');pages.push(id);
 }
 context.pages=pages;return context;
}

test('preflight selects an explicit verified personal-space owner and preserves each visibility without changing data',t=>{
 const x=setup(t), result=inspectLegacyMigration({db:x.db,dataDir:x.root,accountId:'owner',pageIds:x.pages});
 assert.equal(result.workspaceId,'personal');assert.deepEqual(result.pages.map(p=>p.accessMode),['private','public']);
 assert.equal(result.pages.reduce((sum,p)=>sum+p.sizeBytes,0),10);
 assert.equal(x.db.prepare('SELECT count(*) n FROM pages').get().n,2);
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
 assert.throws(()=>inspectLegacyMigration({db:x.db,dataDir:x.root,accountId:'other',pageIds:x.pages}),/account|workspace/i);
 assert.throws(()=>inspectLegacyMigration({db:x.db,dataDir:x.root,accountId:'owner',pageIds:[x.pages[0],x.pages[0]]}),/selection/i);
});

test('migration copies history, preserves access, revokes the old page and is idempotent',t=>{
 const x=setup(t),service=createLegacyMigration({db:x.db,dataDir:x.root,assertOffline:()=>true});
 const oldRelease='2-bbbbbbbbbb',oldDir=path.join(x.root,'storage','sites',x.pages[0],'releases',oldRelease);fs.mkdirSync(oldDir);fs.writeFileSync(path.join(oldDir,'index.html'),'older');
 x.db.prepare('INSERT INTO page_releases VALUES (?,?,?,?,?,?,?,?,?)').run(x.pages[0],oldRelease,oldDir,'index.html','html','old.html',5,1,'2025-01-01T00:00:00.000Z');
 const first=service.migrate({accountId:'owner',pageId:x.pages[0]});
 assert.match(first.pageId,/^w-[a-f0-9]{32}$/);assert.equal(first.accessMode,'private');
 assert.equal(x.db.prepare('SELECT 1 FROM pages WHERE id=?').get(x.pages[0]),undefined);
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_page_visibility WHERE page_id=?').get(first.pageId).n,0);
 assert.equal(fs.readFileSync(path.join(x.root,'workspace-storage','sites',first.pageId,'releases','1-aaaaaaaaaa','index.html'),'utf8'),'hello');
 assert.equal(fs.readFileSync(path.join(x.root,'workspace-storage','sites',first.pageId,'releases',oldRelease,'index.html'),'utf8'),'older');
 assert.equal(x.db.prepare('SELECT created_at FROM workspace_page_releases WHERE page_id=? AND release_id=?').get(first.pageId,oldRelease).created_at,'2025-01-01T00:00:00.000Z');
 assert.equal(fs.readFileSync(path.join(x.root,'storage','sites',x.pages[0],'releases','1-aaaaaaaaaa','index.html'),'utf8'),'hello');
 assert.deepEqual(service.migrate({accountId:'owner',pageId:x.pages[0]}),first);
 const second=service.migrate({accountId:'owner',pageId:x.pages[1]});assert.equal(second.accessMode,'public');
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_page_visibility WHERE page_id=?').get(second.pageId).n,1);
 assert.throws(()=>service.migrate({accountId:'other',pageId:x.pages[0]}),/account|workspace/i);
});

test('a failed migration restores the old page and leaves no partially published application',t=>{
 const x=setup(t),service=createLegacyMigration({db:x.db,dataDir:x.root,assertOffline:()=>true,onStage:stage=>{if(stage==='copied')throw Error('injected');}});
 assert.throws(()=>service.migrate({accountId:'owner',pageId:x.pages[0]}),/injected/);
 assert.ok(x.db.prepare('SELECT 1 FROM pages WHERE id=?').get(x.pages[0]));
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
 assert.equal(x.db.prepare('SELECT count(*) n FROM legacy_migration_journal').get().n,0);
 assert.deepEqual(fs.readdirSync(path.join(x.root,'workspace-storage','sites')),[]);
});
test('migration detects same-size source changes during copying and aborts',t=>{
 const x=setup(t),source=path.join(x.root,'storage','sites',x.pages[0],'releases','1-aaaaaaaaaa','index.html');
 const service=createLegacyMigration({db:x.db,dataDir:x.root,assertOffline:()=>true,onStage:stage=>{if(stage==='copied')fs.writeFileSync(source,'HELLO');}});
 assert.throws(()=>service.migrate({accountId:'owner',pageId:x.pages[0]}),/changed/);
 assert.ok(x.db.prepare('SELECT 1 FROM pages WHERE id=?').get(x.pages[0]));
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
});

test('retry does not claim success when the migrated application was later deleted',t=>{
 const x=setup(t),service=createLegacyMigration({db:x.db,dataDir:x.root,assertOffline:()=>true});
 const result=service.migrate({accountId:'owner',pageId:x.pages[0]});
 x.db.prepare('DELETE FROM workspace_pages WHERE id=?').run(result.pageId);
 assert.throws(()=>service.migrate({accountId:'owner',pageId:x.pages[0]}),/target.*missing/i);
});
test('retry reports the current access mode if the migrated page was changed',t=>{
 const x=setup(t),service=createLegacyMigration({db:x.db,dataDir:x.root,assertOffline:()=>true});
 const result=service.migrate({accountId:'owner',pageId:x.pages[0]});
 x.db.prepare('INSERT INTO workspace_page_visibility VALUES (?)').run(result.pageId);
 assert.equal(service.migrate({accountId:'owner',pageId:x.pages[0]}).accessMode,'public');
});

test('process interruption at migration boundaries is recoverable without deleting a published page',async t=>{
 for(const stage of ['journaled','copied','committed']){
  const x=setup(t);x.db.close();
  const databaseUrl=new URL('../server/database.js',import.meta.url).href, migrationUrl=new URL('../server/legacy-migration.js',import.meta.url).href;
  const script=`import {openDatabase} from ${JSON.stringify(databaseUrl)};import {createLegacyMigration} from ${JSON.stringify(migrationUrl)};const db=openDatabase(process.argv[1]);createLegacyMigration({db,dataDir:process.argv[2],assertOffline:()=>true,onStage:s=>{if(s===process.argv[3])process.exit(73)}}).migrate({accountId:'owner',pageId:process.argv[4]});`;
  const child=spawnSync(process.execPath,['--no-warnings=ExperimentalWarning','--input-type=module','-e',script,path.join(x.root,'hostlet.sqlite'),x.root,stage,x.pages[0]],{encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);x.db=openDatabase(path.join(x.root,'hostlet.sqlite'));
  const service=createLegacyMigration({db:x.db,dataDir:x.root,assertOffline:()=>true});
  if(stage==='copied'){
    const config=loadConfig({ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:x.root});
    x.db.prepare('UPDATE legacy_migration_journal SET storage_root=?').run(path.join(x.root,'wrong'));
    await assert.rejects(createApps({config,db:x.db,accountSender:async()=>{}}),/Invalid migration journal/);
    assert.ok(x.db.prepare('SELECT 1 FROM pages WHERE id=?').get(x.pages[0]));
    x.db.prepare('UPDATE legacy_migration_journal SET storage_root=?').run(path.join(x.root,'workspace-storage'));
    await createApps({config,db:x.db,accountSender:async()=>{}});
  }
  service.recover();service.recover();
  const published=x.db.prepare('SELECT * FROM legacy_migration_map WHERE legacy_id=?').get(x.pages[0]);
  assert.equal(Boolean(published),stage==='committed');
  assert.equal(Boolean(x.db.prepare('SELECT 1 FROM pages WHERE id=?').get(x.pages[0])),stage!=='committed');
  assert.equal(x.db.prepare('SELECT count(*) n FROM legacy_migration_journal').get().n,0);
  if(published)assert.equal(fs.readFileSync(path.join(x.root,'workspace-storage','sites',published.target_id,'releases','1-aaaaaaaaaa','index.html'),'utf8'),'hello');
  else assert.deepEqual(fs.readdirSync(path.join(x.root,'workspace-storage','sites')),[]);
 }
});

test('backup check rejects a changed source or incomplete selected files',t=>{
 const x=setup(t),backup=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-migration-backup-'));t.after(()=>fs.rmSync(backup,{recursive:true,force:true}));
 x.db.close();fs.cpSync(x.root,backup,{recursive:true});x.db=openDatabase(path.join(x.root,'hostlet.sqlite'));
 const plan=inspectLegacyMigration({db:x.db,dataDir:x.root,accountId:'owner',pageIds:[x.pages[0]]});
 assert.equal(verifyLegacyMigrationBackup({db:x.db,dataDir:x.root,backupDir:backup,plan}),true);
 fs.writeFileSync(path.join(backup,'storage','sites',x.pages[0],'releases','1-aaaaaaaaaa','index.html'),'HELLO');
 assert.throws(()=>verifyLegacyMigrationBackup({db:x.db,dataDir:x.root,backupDir:backup,plan}),/backup/i);
 assert.throws(()=>verifyLegacyMigrationBackup({db:x.db,dataDir:x.root,backupDir:x.root,plan}),/backup/i);
});

test('offline command requires explicit backup confirmation and migrates only the selected page',t=>{
 const x=setup(t),backup=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-migration-cli-backup-'));t.after(()=>fs.rmSync(backup,{recursive:true,force:true}));
 x.db.close();fs.cpSync(x.root,backup,{recursive:true});
 const script=fileURLToPath(new URL('../server/migrate-legacy.js',import.meta.url)),args=['--data-dir',x.root,'--account-id','owner','--page-id',x.pages[0]];
 try {
  const inspect=spawnSync(process.execPath,[script,'inspect',...args],{encoding:'utf8'});
  assert.equal(inspect.status,0,inspect.stderr);assert.equal(JSON.parse(inspect.stdout).pages[0].accessMode,'private');
  const unconfirmed=spawnSync(process.execPath,[script,'migrate',...args,'--backup-dir',backup],{encoding:'utf8'});
  assert.notEqual(unconfirmed.status,0);
  const missing=spawnSync(process.execPath,[script,'migrate',...args,'--backup-dir',path.join(backup,'missing'),'--confirm-backup'],{encoding:'utf8'});
  assert.notEqual(missing.status,0);
  const run=spawnSync(process.execPath,[script,'migrate',...args,'--backup-dir',backup,'--confirm-backup'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.match(JSON.parse(run.stdout).pageId,/^w-/);
 } finally {x.db=openDatabase(path.join(x.root,'hostlet.sqlite'));}
 assert.equal(x.db.prepare('SELECT count(*) n FROM pages').get().n,1);
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
});

test('preflight rejects symbolic links in legacy application files',t=>{
 const x=setup(t),file=path.join(x.root,'storage','sites',x.pages[0],'releases','1-aaaaaaaaaa','index.html');
 fs.unlinkSync(file);
 try {fs.symlinkSync(path.join(x.root,'hostlet.sqlite'),file,'file');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('symbolic links unavailable');return;}throw error;}
 assert.throws(()=>inspectLegacyMigration({db:x.db,dataDir:x.root,accountId:'owner',pageIds:[x.pages[0]]}),/unsafe/i);
});

test('offline command refuses a data directory held by a running instance',t=>{
 const x=setup(t);x.db.close();const lock=acquireInstanceLock(x.root);
 try {
  const script=fileURLToPath(new URL('../server/migrate-legacy.js',import.meta.url));
  const result=spawnSync(process.execPath,[script,'list','--data-dir',x.root],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/already in use/i);
 } finally {lock.release();x.db=openDatabase(path.join(x.root,'hostlet.sqlite'));}
 assert.equal(x.db.prepare('SELECT count(*) n FROM pages').get().n,2);
});

test('migrated private and public pages enforce their visibility and old URLs stop working',async t=>{
 const x=setup(t),service=createLegacyMigration({db:x.db,dataDir:x.root,assertOffline:()=>true});
 const privatePage=service.migrate({accountId:'owner',pageId:x.pages[0]}), publicPage=service.migrate({accountId:'owner',pageId:x.pages[1]});
 const config=loadConfig({ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:x.root});
 config.hosting={appDomain:'apps.example.test',managementOrigin:'https://admin.hostlet.test'};
 const {hosted}=await createApps({config,db:x.db,accountSender:async()=>{}});
 const server=http.createServer(hosted);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=(host,url)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,headers:{host}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});
 assert.equal((await call('legacy.example.test','/p/private/')).status,404);
 assert.equal((await call(`${privatePage.pageId}.apps.example.test`,'/')).status,401);
 const opened=await call(`${publicPage.pageId}.apps.example.test`,'/');assert.equal(opened.status,200);assert.equal(opened.body,'hello');
});

test('preflight rejects out-of-root paths, altered files, and insufficient quota',t=>{
 const x=setup(t),args={db:x.db,dataDir:x.root,accountId:'owner',pageIds:[x.pages[0]]};
 const old=x.db.prepare('SELECT release_dir FROM page_releases WHERE page_id=?').get(x.pages[0]).release_dir;
 x.db.prepare('UPDATE page_releases SET release_dir=? WHERE page_id=?').run(path.join(x.root,'outside'),x.pages[0]);
 assert.throws(()=>inspectLegacyMigration(args),/path/i);
 x.db.prepare('UPDATE page_releases SET release_dir=? WHERE page_id=?').run(old,x.pages[0]);fs.writeFileSync(path.join(old,'index.html'),'changed');
 assert.throws(()=>inspectLegacyMigration(args),/size|metadata/i);
 fs.writeFileSync(path.join(old,'index.html'),'hello');
 x.db.prepare('INSERT INTO workspace_quotas VALUES (?,?,?,?)').run('personal',0,100,100);
 assert.throws(()=>inspectLegacyMigration(args),/quota/i);
 assert.equal(x.db.prepare('SELECT count(*) n FROM pages').get().n,2);
});
