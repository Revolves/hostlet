import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { deletionJournalSql, createWorkspaceDeletionService } from '../server/workspace-deletion.js';

const id='w-0123456789abcdef0123456789abcdef';
function setup(t){
 const root=fs.mkdtempSync(path.join(process.cwd(),'.hostlet-deletion-test-')); const storage=path.join(root,'storage'); fs.mkdirSync(path.join(storage,'sites',id,'releases'),{recursive:true}); fs.writeFileSync(path.join(storage,'sites',id,'releases','payload.html'),'protected');
 const file=path.join(root,'test.sqlite');const db=new DatabaseSync(file);db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE workspace_pages(id TEXT PRIMARY KEY,workspace_id TEXT,storage_id TEXT); CREATE TABLE workspace_page_revisions(page_id TEXT PRIMARY KEY,revision INTEGER);`);db.exec(deletionJournalSql);db.prepare('INSERT INTO workspace_pages VALUES (?,?,?)').run(id,'w',id);db.prepare('INSERT INTO workspace_page_revisions VALUES (?,?)').run(id,2);
 const context={root,storage,file,db};t.after(()=>{context.db.close();fs.rmSync(root,{recursive:true,force:true});});return context;
}
const pageDir=x=>path.join(x.storage,'sites',id);
const make=(x,hook)=>createWorkspaceDeletionService({db:x.db,storageRoot:x.storage,assertQuiescent:()=>true,onStage:hook});
const remove=(s,validate=()=>true)=>s.execute({pageId:id,workspaceId:'w',revision:2,validate});
test('isolates, transactionally validates, deletes and recovers on temporary storage',t=>{
 const x=setup(t); const s=make(x); assert.equal(remove(s),true); assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0); assert.equal(fs.existsSync(pageDir(x)),false); assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_deletion_journal').get().n,0);
});
test('failed validation and transaction failure restore live files',t=>{
 const x=setup(t); const s=make(x); assert.equal(remove(s,()=>false),false); assert.equal(fs.readFileSync(path.join(pageDir(x),'releases','payload.html'),'utf8'),'protected');
 x.db.exec("CREATE TRIGGER deny_delete BEFORE DELETE ON workspace_pages BEGIN SELECT RAISE(ABORT,'failure'); END"); assert.throws(()=>remove(s)); assert.equal(fs.readFileSync(path.join(pageDir(x),'releases','payload.html'),'utf8'),'protected');
});
test('audit failure rolls back the deletion and restores the application',t=>{
 const x=setup(t);const s=createWorkspaceDeletionService({db:x.db,storageRoot:x.storage,assertQuiescent:()=>true,onDelete:()=>{throw Error('audit failed');}});
 assert.throws(()=>remove(s),/audit failed/);
 assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
 assert.equal(fs.readFileSync(path.join(pageDir(x),'releases','payload.html'),'utf8'),'protected');
});
test('refuses untrusted identifiers, symlinks, and absent quiescence',t=>{
 const x=setup(t);assert.throws(()=>createWorkspaceDeletionService({db:x.db,storageRoot:x.storage}));
 const s=make(x);assert.throws(()=>s.execute({pageId:'../escape',workspaceId:'w',revision:2,validate:()=>true}));
 try {fs.symlinkSync(x.root,path.join(pageDir(x),'link'),process.platform==='win32'?'junction':'dir');} catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('symlink not permitted');return;}throw e;}
 assert.throws(()=>remove(s));assert.ok(fs.existsSync(path.join(x.root,'test.sqlite')));assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
});
test('recovers after subprocess termination at every persisted boundary',t=>{
 for(const stage of ['journaled','isolated','deleted','committed']){
  const x=setup(t);x.db.close();
  const script=`import {DatabaseSync} from 'node:sqlite';import {createWorkspaceDeletionService} from './server/workspace-deletion.js';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA foreign_keys=ON');const s=createWorkspaceDeletionService({db,storageRoot:process.argv[2],assertQuiescent:()=>true,onStage:s=>{if(s===process.argv[3])process.exit(73)}});s.execute({pageId:process.argv[4],workspaceId:'w',revision:2,validate:()=>true});`;
  const child=spawnSync(process.execPath,['--no-warnings=ExperimentalWarning','--input-type=module','-e',script,x.file,x.storage,stage,id],{cwd:process.cwd(),encoding:'utf8'});assert.equal(child.status,73,child.stderr);
  x.db=new DatabaseSync(x.file);x.db.exec('PRAGMA foreign_keys=ON');const s=make(x);s.recover();s.recover();const exists=!!x.db.prepare('SELECT 1 FROM workspace_pages WHERE id=?').get(id);assert.equal(exists,stage!=='committed');assert.equal(fs.existsSync(pageDir(x)),exists);assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_deletion_journal').get().n,0);
 }
});

test('recovery refuses conflicting paths, live storage references and wrong roots',t=>{
 const x=setup(t);const s=make(x,stage=>{if(stage==='isolated')throw Error('pause');});
 x.db.exec("CREATE TRIGGER deny_restore BEFORE DELETE ON workspace_deletion_journal BEGIN SELECT RAISE(ABORT,'injected'); END");assert.throws(()=>remove(s));
 x.db.exec('DROP TRIGGER deny_restore');const j=x.db.prepare('SELECT * FROM workspace_deletion_journal').get();
 assert.ok(j);x.db.prepare('UPDATE workspace_deletion_journal SET storage_root=?').run(path.join(x.root,'wrong'));assert.throws(()=>make(x).recover());
 x.db.prepare('UPDATE workspace_deletion_journal SET storage_root=?').run(x.storage);make(x).recover();assert.ok(fs.existsSync(pageDir(x)));
});
test('retention rechecks policy after isolation inside deletion transaction',async t=>{
 const {retentionSchema,createRetentionService}=await import('../server/retention.js');const x=setup(t);
 x.db.exec(`ALTER TABLE workspace_pages ADD COLUMN updated_at TEXT; UPDATE workspace_pages SET updated_at='2026-01-01T00:00:00.000Z';
 CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,email_verified_at INTEGER); CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE workspace_members(workspace_id TEXT,user_id TEXT,role TEXT); CREATE TABLE platform_settings(id INTEGER PRIMARY KEY,value TEXT);
 INSERT INTO users VALUES('u','u@example.com',1);INSERT INTO workspaces VALUES('w');INSERT INTO workspace_members VALUES('w','u','owner');`);
 x.db.exec(retentionSchema); const setPolicy=p=>x.db.prepare('INSERT INTO platform_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify({retention:p}));
 const policy={mode:'inactivity',days:30,notifyBeforeDays:7};setPolicy(policy);let time=Date.parse('2026-01-24T00:00:00Z'), change=true;
 const deletion=make(x,stage=>{if(stage==='isolated'&&change){change=false;setPolicy({mode:'long-term',days:null,notifyBeforeDays:null});}});
 const service=createRetentionService({db:x.db,now:()=>time,sender:async()=>true,deletion});await service.scan();time+=7*86400000;await service.scan();
 assert.ok(x.db.prepare('SELECT 1 FROM workspace_pages').get());assert.ok(fs.existsSync(pageDir(x)));
 setPolicy(policy);await service.scan();time+=7*86400000;await service.scan();assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);assert.equal(fs.existsSync(pageDir(x)),false);
});

test('deferred foreign-key failure at COMMIT restores isolated files',t=>{
 const x=setup(t);x.db.exec(`CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER fail_commit AFTER DELETE ON workspace_pages BEGIN INSERT INTO child VALUES(42);END;`);
 assert.throws(()=>remove(make(x)));assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);assert.equal(x.db.prepare('SELECT count(*) n FROM child').get().n,0);assert.equal(fs.readFileSync(path.join(pageDir(x),'releases','payload.html'),'utf8'),'protected');
});
test('new revision during isolation prevents deletion and restores directory',t=>{
 const x=setup(t);let changed=false;const s=make(x,stage=>{if(stage==='isolated'){changed=true;x.db.prepare('UPDATE workspace_page_revisions SET revision=3 WHERE page_id=?').run(id);}});
 assert.equal(remove(s),false);assert.equal(changed,true);assert.ok(x.db.prepare('SELECT 1 FROM workspace_pages').get());assert.ok(fs.existsSync(pageDir(x)));
});
test('failed maintenance check prevents filesystem and journal mutation',t=>{
 const x=setup(t);const s=createWorkspaceDeletionService({db:x.db,storageRoot:x.storage,assertQuiescent:()=>false});assert.throws(()=>remove(s));assert.throws(()=>s.recover());assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_deletion_journal').get().n,0);assert.ok(fs.existsSync(pageDir(x)));
});

test('quarantined directory is retained while another page references storage',t=>{
 const x=setup(t);const s=make(x,stage=>{if(stage==='committed')x.db.prepare('INSERT INTO workspace_pages VALUES (?,?,?)').run('other','w',id);});
 assert.throws(()=>remove(s));const row=x.db.prepare('SELECT * FROM workspace_deletion_journal').get();const q=path.join(x.storage,'sites',`.retention-${row.quarantine_id}`);assert.ok(fs.existsSync(q));
 x.db.prepare('DELETE FROM workspace_pages WHERE id=?').run('other');make(x).recover();assert.equal(fs.existsSync(q),false);
});
