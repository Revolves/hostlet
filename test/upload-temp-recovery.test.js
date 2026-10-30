import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../server/database.js';
import {loadConfig} from '../server/config.js';
import {createApps} from '../server/app.js';
import {uploadTempJournalSql,createUploadTempJournal} from '../server/upload-temp-recovery.js';

const id='11111111-1111-4111-8111-111111111111';
function setup(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-upload-recovery-'));fs.mkdirSync(path.join(root,'tmp'));
 const db=new DatabaseSync(':memory:');db.exec(uploadTempJournalSql);t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const journal=createUploadTempJournal({db,storageRoot:root,assertQuiescent:()=>true});return {root,db,journal};
}
test('startup removes only recorded upload files and is idempotent',t=>{
 const {root,db,journal}=setup(t),unrelated=path.join(root,'tmp','other');fs.writeFileSync(unrelated,'preserve');
 const upload=journal.open(id);fs.writeSync(upload.fd,'partial');fs.closeSync(upload.fd);
 assert.equal(db.prepare('SELECT count(*) n FROM workspace_upload_temp_journal').get().n,1);
 journal.recover();journal.recover();assert.equal(fs.existsSync(upload.path),false);assert.equal(fs.readFileSync(unrelated,'utf8'),'preserve');
 assert.equal(db.prepare('SELECT count(*) n FROM workspace_upload_temp_journal').get().n,0);
});
test('collision and invalid root do not remove existing files',t=>{
 const {root,db,journal}=setup(t),file=path.join(root,'tmp',`upload-${id}`);fs.writeFileSync(file,'preserve');
 assert.throws(()=>journal.open(id),/exist/i);assert.equal(fs.readFileSync(file,'utf8'),'preserve');
 db.prepare('INSERT INTO workspace_upload_temp_journal VALUES (?,?)').run(id,path.join(root,'other'));
 assert.throws(()=>journal.recover(),/root|record/i);assert.equal(fs.readFileSync(file,'utf8'),'preserve');
});
test('recovery requires an exclusive maintenance window',t=>{
 const {root,db,journal}=setup(t),upload=journal.open(id);fs.closeSync(upload.fd);
 const unavailable=createUploadTempJournal({db,storageRoot:root,assertQuiescent:()=>false});
 assert.throws(()=>unavailable.recover(),/maintenance/i);assert.equal(fs.existsSync(upload.path),true);
});
test('recovery refuses a recorded path that has become a directory',t=>{
 const {db,journal}=setup(t),upload=journal.open(id);fs.closeSync(upload.fd);fs.unlinkSync(upload.path);fs.mkdirSync(upload.path);fs.writeFileSync(path.join(upload.path,'keep'),'safe');
 assert.throws(()=>journal.recover(),/unsafe/i);assert.equal(fs.readFileSync(path.join(upload.path,'keep'),'utf8'),'safe');
 assert.equal(db.prepare('SELECT count(*) n FROM workspace_upload_temp_journal').get().n,1);
});
test('a new service instance recovers a recorded upload after process termination',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-upload-crash-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const storage=path.join(root,'workspace-storage'),temp=path.join(storage,'tmp');fs.mkdirSync(temp,{recursive:true});
 const database=path.join(root,'hostlet.sqlite');openDatabase(database).close();
 const unrelated=path.join(temp,'unrecorded');fs.writeFileSync(unrelated,'preserve');
 const script=`import fs from 'node:fs';import {openDatabase} from './server/database.js';import {createUploadTempJournal} from './server/upload-temp-recovery.js';const db=openDatabase(process.argv[1]);const j=createUploadTempJournal({db,storageRoot:process.argv[2],assertQuiescent:()=>true});const file=j.open(process.argv[3]);fs.writeSync(file.fd,'partial');process.exit(73);`;
 const child=spawnSync(process.execPath,['--no-warnings=ExperimentalWarning','--input-type=module','-e',script,database,storage,id],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(child.status,73,child.stderr);const file=path.join(temp,`upload-${id}`);assert.equal(fs.existsSync(file),true);
 const db=openDatabase(database);
 const config=loadConfig({ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:root});
 try {
  await createApps({config,db,accountSender:async()=>{}});
  assert.equal(fs.existsSync(file),false);assert.equal(fs.readFileSync(unrelated,'utf8'),'preserve');
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_upload_temp_journal').get().n,0);
 } finally {db.close();}
});
