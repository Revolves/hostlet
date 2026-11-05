import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import JSZip from 'jszip';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { workspaceSchema, createWorkspaceService } from '../server/workspaces.js';
import { FileSiteStorage } from '../server/storage.js';
import { createUploader } from '../server/upload.js';
import { workspacePagesSchema, workspacePageReleasesMigrationSql, createWorkspacePagesService, createWorkspaceQuotaService } from '../server/workspace-pages.js';
import { createWorkspacePagesRouter } from '../server/workspace-pages-router.js';
import { quotaMigrationSql } from '../server/quotas.js';
import { workspaceVisibilitySchema, publicationReviewSchema, createWorkspaceVisibilityService } from '../server/workspace-visibility.js';
import { releaseCleanupSchema, createReleaseCleanup } from '../server/release-cleanup.js';
import { createMaintenanceGate } from '../server/maintenance.js';
import { deletionJournalSql, createWorkspaceDeletionService } from '../server/workspace-deletion.js';
import { publicationJournalSql, createPublicationRecovery } from '../server/publication-recovery.js';
import {uploadTempJournalSql,createUploadTempJournal} from '../server/upload-temp-recovery.js';

async function setup(t, options = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workspace-pages-'));
  const db = new DatabaseSync(path.join(root, 'test.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY);');
  db.exec(workspaceSchema); db.exec(workspacePagesSchema); db.exec(workspacePageReleasesMigrationSql); db.exec(quotaMigrationSql); db.exec(workspaceVisibilitySchema); db.exec(publicationReviewSchema); db.exec(releaseCleanupSchema);
  db.exec(deletionJournalSql);
  db.exec(publicationJournalSql);
  db.exec(uploadTempJournalSql);
  for (const id of ['owner', 'editor', 'viewer', 'outsider']) db.prepare('INSERT INTO users VALUES (?)').run(id);
  const ws = createWorkspaceService(db);
  const team = ws.createWorkspace('owner', { type: 'team', name: 'Team' });
  const other = ws.createWorkspace('outsider', { type: 'personal', name: 'Other' });
  for (const role of ['editor', 'viewer']) db.prepare('INSERT INTO workspace_members VALUES (?,?,?,?)').run(team.id, role, role, new Date().toISOString());
  const storage = new FileSiteStorage(path.join(root, 'storage')); await storage.ensure();
  const uploader = createUploader({ config: { maxUploadBytes: options.platformLimit ?? 1000000 }, tmpDir: path.join(root, 'uploads') });
  const service = createWorkspacePagesService({ db, workspaceService: ws, storage, quotaClock: options.clock, quotaDefaults: options.quotaDefaults, maxReleases: options.maxReleases });
  const app = express(); const maintenance=createMaintenanceGate();
  const tempFiles=createUploadTempJournal({db,storageRoot:storage.root,assertQuiescent:maintenance.isQuiescent});
  const deletion=createWorkspaceDeletionService({db,storageRoot:storage.root,assertQuiescent:maintenance.isQuiescent,onStage:options.onDeletionStage});
  const deletePage=(workspace,actor,id)=>{const page=service.get(workspace,actor,id); service.authorize(workspace,actor,'manage'); return deletion.execute({pageId:id,workspaceId:workspace,revision:page.revision,validate:()=>{service.authorize(workspace,actor,'manage');return true;}});};
  if (options.onResponse) app.use((_req,res,next)=>{options.onResponse(res);next();});
  app.use(maintenance.middleware); app.use(express.json());
  const requireUser = (req, res, next) => { if (!req.get('x-user')) return res.sendStatus(401); req.user = { id: req.get('x-user') }; next(); };
  app.use('/workspaces', createWorkspacePagesRouter({ service, requireUser, uploader, deletePage, tempFiles, visibility: createWorkspaceVisibilityService({db,authorize:ws.authorize}), releaseCleanup: createReleaseCleanup({db,storageRoot:storage.root,authorize:ws.authorize}) }));
  const server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); await fs.promises.rm(root, { recursive: true, force: true }); });
  async function call(user, method, url, body) {
    const headers = { 'x-user': user }; if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
    const r = await fetch(`http://127.0.0.1:${server.address().port}/workspaces${url}`, { method, headers, body });
    const text = await r.text(); return { status: r.status, body: text ? JSON.parse(text) : null };
  }
  function form(content = '<h1>hello</h1>', filename = 'index.html', fields = {}) {
    const data = new FormData(); data.set('title', 'Example'); data.set('file', new Blob([content]), filename);
    for (const [k, v] of Object.entries(fields)) data.set(k, v); return data;
  }
  return { root, db, ws, team: team.id, other: other.id, storage, service, call, form, maintenance, port:server.address().port };
}

test('a revoked upload credential cannot publish after staging', async t => {
  const {root,team,db,storage,service}=await setup(t);
  const input=path.join(root,'input.html');await fs.promises.writeFile(input,'<h1>test</h1>');
  let valid=true;
  const guard=()=>{if(!valid) throw new Error('revoked');};
  const reservation=service.beginUpload(team,'owner','index.html',100,undefined,guard);
  const stage=storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml=async args=>{const result=await stage(args);valid=false;return result;};
  try {await assert.rejects(service.create(team,'owner',{path:input,originalname:'index.html',size:13},{title:'Test'},reservation),/revoked/);}
  finally {service.cancelUpload(reservation);}
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
  assert.deepEqual(await fs.promises.readdir(path.join(root,'storage','sites')),[]);
});

test('user deletion uses the recovery journal under exclusive maintenance',async t=>{
  const stages=[]; const {team,call,form,db,root}=await setup(t,{onDeletionStage:s=>stages.push(s)});
  const base=`/${team}/pages`, page=(await call('owner','POST',base,form())).body.page;
  assert.equal((await call('editor','DELETE',`${base}/${page.id}`)).status,403);
  assert.equal((await call('owner','DELETE',`${base}/${page.id}`)).status,204);
  assert.deepEqual(stages,['journaled','isolated','deleted','committed']);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_deletion_journal').get().n,0);
  assert.equal(fs.existsSync(path.join(root,'storage','sites',page.id)),false);
});

test('uploads record their owned staging directory before writing and clear it after publication',async t=>{
  const {team,call,form,db,storage}=await setup(t); const seen=[];
  const stage=storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml=async args=>{seen.push(db.prepare('SELECT staging_id,page_id FROM workspace_publication_journal WHERE staging_id=?').get(args.pageId));return stage(args);};
  const base=`/${team}/pages`, first=await call('owner','POST',base,form('one'));assert.equal(first.status,201);
  const page=first.body.page;
  assert.equal((await call('owner','POST',`${base}/${page.id}/replace`,form('two','index.html',{revision:'0'}))).status,200);
  assert.equal(seen.length,2);assert.equal(seen[0]?.staging_id,page.id);assert.equal(seen[0]?.page_id,page.id);
  assert.equal(seen[1]?.page_id,page.id);assert.notEqual(seen[1]?.staging_id,page.id);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_publication_journal').get().n,0);
});

test('upload records the raw temporary file while processing and removes its journal afterwards',async t=>{
 const {team,call,form,storage,db}=await setup(t);const stage=storage.stageSingleHtml.bind(storage);let observed=false;
 storage.stageSingleHtml=async args=>{assert.equal(db.prepare('SELECT count(*) n FROM workspace_upload_temp_journal').get().n,1);observed=true;return stage(args);};
 assert.equal((await call('owner','POST',`/${team}/pages`,form())).status,201);assert.equal(observed,true);
 assert.equal(db.prepare('SELECT count(*) n FROM workspace_upload_temp_journal').get().n,0);
});

test('an interrupted replacement is recovered without removing the current release',async t=>{
  const {team,call,form,db,root,storage,maintenance}=await setup(t);
  const page=(await call('owner','POST',`/${team}/pages`,form('original'))).body.page;
  const input=path.join(root,'next.html');fs.writeFileSync(input,'replacement');
  const script=`import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {createWorkspaceService} from './server/workspaces.js';import {FileSiteStorage} from './server/storage.js';import {createWorkspacePagesService} from './server/workspace-pages.js';
    const [file,root,workspace,page,input]=process.argv.slice(1);const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');const storage=new FileSiteStorage(root);const service=createWorkspacePagesService({db,workspaceService:createWorkspaceService(db),storage});
    const reservation=service.beginUpload(workspace,'owner','next.html',100,page);const rename=fs.renameSync;fs.renameSync=(...args)=>{rename(...args);process.exit(73)};
    await service.replace(workspace,'owner',page,{path:input,originalname:'next.html',size:11},{revision:0},reservation);`;
  const child=spawnSync(process.execPath,['--no-warnings=ExperimentalWarning','--input-type=module','-e',script,path.join(root,'test.sqlite'),storage.root,team,page.id,input],{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);
  const row=db.prepare('SELECT * FROM workspace_publication_journal').get();assert.ok(row?.release_id);
  const orphan=path.join(storage.root,'sites',page.id,'releases',row.release_id);assert.equal(fs.existsSync(orphan),true);
  await maintenance.runExclusive(()=>createPublicationRecovery({db,storageRoot:storage.root,assertQuiescent:maintenance.isQuiescent}).recover());
  assert.equal(fs.existsSync(orphan),false);
  assert.equal(fs.readFileSync(path.join(storage.root,'sites',page.id,'releases',page.releaseId,'index.html'),'utf8'),'original');
  assert.equal((await call('owner','GET',`/${team}/pages/${page.id}`)).body.page.releaseId,page.releaseId);
});

test('maintenance waits for an interrupted upload to finish its staging and cleanup', async t => {
  let closed; const disconnected=new Promise(resolve=>{closed=resolve;});
  const {team,port,storage,form,maintenance,db}=await setup(t,{onResponse:res=>res.once('close',closed)});
  let entered, resume; const started=new Promise(resolve=>{entered=resolve;}); const wait=new Promise(resolve=>{resume=resolve;});
  const stage=storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml=async args=>{const result=await stage(args);entered();await wait;return result;};
  const controller=new AbortController();
  const upload=fetch(`http://127.0.0.1:${port}/workspaces/${team}/pages`,{method:'POST',headers:{'x-user':'owner'},body:form(),signal:controller.signal}).catch(()=>null);
  await started; controller.abort(); await disconnected;
  let ran=false; const maintenanceRun=maintenance.runExclusive(async()=>{ran=true;assert.equal(maintenance.isQuiescent(),true);});
  const blocked=await fetch(`http://127.0.0.1:${port}/workspaces/${team}/pages`,{headers:{'x-user':'owner'}});
  assert.equal(blocked.status,503); assert.equal(ran,false);
  resume(); await upload; await maintenanceRun;
  assert.equal(ran,true);assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
  assert.equal((await fetch(`http://127.0.0.1:${port}/workspaces/${team}/pages`,{headers:{'x-user':'owner'}})).status,200);
});

test('version limit prevents another publication until an old version is removed', async t => {
  const {team,call,form}=await setup(t,{maxReleases:2}), base=`/${team}/pages`;
  const first=(await call('owner','POST',base,form('one'))).body.page, route=`${base}/${first.id}`;
  const second=(await call('editor','POST',`${route}/replace`,form('two','index.html',{revision:'0'}))).body.page;
  const denied=await call('editor','POST',`${route}/replace`,form('three','index.html',{revision:'1'}));
  assert.equal(denied.status,409); assert.equal(denied.body.code,'HISTORY_LIMIT');
  assert.equal((await call('editor','DELETE',`${route}/releases/${first.releaseId}`,{revision:second.revision})).status,200);
  assert.equal((await call('editor','POST',`${route}/replace`,form('three','index.html',{revision:'2'}))).status,200);
});

test('history deletion is authorized, rejects active and stale releases, and releases quota', async t => {
  const {team,call,form,root,db}=await setup(t), base=`/${team}/pages`;
  const first=(await call('owner','POST',base,form('old'))).body.page;
  const route=`${base}/${first.id}`;
  const current=(await call('editor','POST',`${route}/replace`,form('new','index.html',{revision:'0'}))).body.page;
  const remove=id=>`${route}/releases/${id}`;
  assert.equal((await call('viewer','DELETE',remove(first.releaseId),{revision:1})).status,403);
  assert.equal((await call('editor','DELETE',remove(current.releaseId),{revision:1})).status,409);
  assert.equal((await call('editor','DELETE',remove(first.releaseId),{revision:0})).status,409);
  assert.equal((await call('editor','DELETE',remove(first.releaseId),{revision:1})).status,200);
  assert.equal((await call('viewer','GET',`${route}/releases`)).body.releases.length,1);
  assert.equal((await call('viewer','GET',route)).body.page.revision,2);
  assert.equal(fs.existsSync(path.join(root,'storage','sites',first.id,'releases',first.releaseId)),false);
  assert.equal(db.prepare('SELECT sum(size_bytes) n FROM workspace_page_releases').get().n,3);
});

test('history cleanup drains active requests and rejects unauthorized users before maintenance',async t=>{
  const {team,call,form,root,maintenance,port}=await setup(t),base=`/${team}/pages`;
  const first=(await call('owner','POST',base,form('old'))).body.page,route=`${base}/${first.id}`;
  const current=(await call('editor','POST',`${route}/replace`,form('new','index.html',{revision:'0'}))).body.page;
  const held=new EventEmitter();maintenance.middleware({},held,()=>{});
  try {
    assert.equal((await call('viewer','DELETE',`${route}/releases/${first.releaseId}`,{revision:current.revision})).status,403);
    const viewerDelete=await Promise.race([call('viewer','DELETE',route),new Promise(resolve=>setTimeout(()=>resolve({status:0}),500))]);
    assert.equal(viewerDelete.status,403);
    assert.equal((await call('viewer','GET',route)).status,200);
    let done=false;const deletion=call('editor','DELETE',`${route}/releases/${first.releaseId}`,{revision:current.revision}).then(result=>{done=true;return result;});
    let paused=false;for(let i=0;i<20 && !paused;i++){const response=await fetch(`http://127.0.0.1:${port}/workspaces${route}`,{headers:{'x-user':'viewer'}});paused=response.status===503;if(!paused)await new Promise(resolve=>setTimeout(resolve,25));}
    assert.equal(paused,true);
    assert.equal(done,false);assert.equal(fs.existsSync(path.join(root,'storage','sites',first.id,'releases',first.releaseId)),true);
    held.emit('finish');assert.equal((await deletion).status,200);
    assert.equal(fs.existsSync(path.join(root,'storage','sites',first.id,'releases',first.releaseId)),false);
  } finally {held.emit('finish');}
});

test('team publication review enforces roles and protects public versions', async t => {
  const {team,call,form}=await setup(t);
  const base=`/${team}/pages`, created=await call('owner','POST',base,form());
  const id=created.body.page.id, url=`${base}/${id}/visibility`;
  assert.equal((await call('viewer','PATCH',url,{visibility:'public'})).status,403);
  assert.equal((await call('editor','PATCH',url,{visibility:'public'})).status,403);
  const review=`${base}/${id}/publication-review`;
  assert.equal((await call('editor','POST',review,{})).status,200);
  assert.equal((await call('viewer','GET',base)).body.pages[0].review.status,'pending');
  assert.equal((await call('editor','POST',`${review}/decision`,{decision:'approve'})).status,403);
  assert.equal((await call('owner','POST',`${review}/decision`,{decision:'approve',comment:'ok'})).status,200);
  assert.equal((await call('viewer','GET',base)).body.pages[0].visibility,'public');
  const replacement=form(); replacement.set('revision',String(created.body.page.revision));
  assert.equal((await call('editor','POST',`${base}/${id}/replace`,replacement)).body.code,'PUBLIC_REVIEW_REQUIRED');
  assert.equal((await call('owner','PATCH',url,{visibility:'private'})).status,200);
  assert.equal((await call('viewer','GET',base)).body.pages[0].visibility,'private');
});

test('ZIP uploads discover a single entry and require a choice when several exist', async t => {
  const {team,call,form,db,root}=await setup(t), base=`/${team}/pages`;
  const single=new JSZip();single.file('site/home.html','home');single.file('site/assets/app.js','ok');
  const singleData=await single.generateAsync({type:'nodebuffer'});
  const created=await call('owner','POST',base,form(singleData,'one.zip'));
  assert.equal(created.status,201);assert.equal(created.body.page.entryFile,'home.html');
  assert.equal(fs.readFileSync(path.join(root,'storage','sites',created.body.page.id,'releases',created.body.page.releaseId,'home.html'),'utf8'),'home');
  const multi=new JSZip();multi.file('index.html','first');multi.file('nested/second.html','second');
  const data=await multi.generateAsync({type:'nodebuffer'});
  const pending=await call('editor','POST',base,form(data,'multi.zip'));
  assert.equal(pending.status,400);assert.equal(pending.body.code,'ENTRY_SELECTION_REQUIRED');
  assert.deepEqual(pending.body.candidates,['index.html','nested/second.html']);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
  const selected=await call('editor','POST',base,form(data,'multi.zip',{entryFile:'nested/second.html'}));
  assert.equal(selected.status,201);assert.equal(selected.body.page.entryFile,'nested/second.html');
  const route=`${base}/${created.body.page.id}`;
  const replace=await call('editor','POST',`${route}/replace`,form(data,'multi.zip',{revision:'0'}));
  assert.equal(replace.status,400);assert.equal(replace.body.code,'ENTRY_SELECTION_REQUIRED');
  assert.equal((await call('viewer','GET',route)).body.page.releaseId,created.body.page.releaseId);
  assert.equal((await call('editor','POST',`${route}/replace`,form(data,'multi.zip',{revision:'0',entryFile:'index.html'}))).status,200);
});

test('ZIP entry errors explain missing HTML or an invalid selected entry',async t=>{
  const {team,call,form,db}=await setup(t),base=`/${team}/pages`;
  const noHtml=new JSZip();noHtml.file('assets/app.js','ok');
  let result=await call('owner','POST',base,form(await noHtml.generateAsync({type:'nodebuffer'}),'empty.zip'));
  assert.equal(result.status,400);assert.equal(result.body.code,'ENTRY_NOT_FOUND');
  const zip=new JSZip();zip.file('index.html','ok');
  result=await call('owner','POST',base,form(await zip.generateAsync({type:'nodebuffer'}),'site.zip',{entryFile:'missing.html'}));
  assert.equal(result.status,400);assert.equal(result.body.code,'ENTRY_NOT_FOUND');
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
});

test('ZIP uploads reject Unix symlinks and special files before publishing',async t=>{
  const {team,call,form,db}=await setup(t),base=`/${team}/pages`;
  for(const mode of [0o120777,0o010644,0o020644,0o060644,0o140644]) {
    const zip=new JSZip();zip.file('index.html','safe');zip.file('unsafe','target',{unixPermissions:mode});
    const payload=await zip.generateAsync({type:'nodebuffer',platform:'UNIX'});
    const result=await call('owner','POST',base,form(payload,'unsafe.zip'));
    assert.equal(result.status,400,`mode ${mode.toString(8)}`);
    assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
  }
});

test('ZIP uploads reject unsafe directory entries even when no file uses them',async t=>{
  const {team,call,form,db}=await setup(t),zip=new JSZip();zip.file('index.html','safe');zip.folder('xx');
  const payload=await zip.generateAsync({type:'nodebuffer'}), from=Buffer.from('xx/'), to=Buffer.from('../');
  for(let offset=0;(offset=payload.indexOf(from,offset))!==-1;offset+=from.length) to.copy(payload,offset);
  assert.equal((await call('owner','POST',`/${team}/pages`,form(payload,'unsafe.zip'))).status,400);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
});

test('ZIP directory entry limits and unsupported ZIP64 are reported to upload clients',async t=>{
 const {team,call,form}=await setup(t),base=`/${team}/pages`,zip=new JSZip();zip.file('index.html','safe');
 for(let i=0;i<4001;i++)zip.folder(`dir${i}`);
 const large=await call('owner','POST',base,form(await zip.generateAsync({type:'nodebuffer'}),'many.zip'));
 assert.equal(large.status,400);assert.equal(large.body.code,'ZIP_TOO_MANY_ENTRIES');
 const small=new JSZip();small.file('index.html','safe');const buffer=await small.generateAsync({type:'nodebuffer'});
 const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));buffer.writeUInt16LE(0xffff,end+10);
 const unsupported=await call('owner','POST',base,form(buffer,'zip64.zip'));
 assert.equal(unsupported.status,400);assert.equal(unsupported.body.code,'ZIP_UNSUPPORTED');
});

test('an upload temporary-name collision never removes an existing file',async t=>{
  const {team,call,form,storage}=await setup(t),id='11111111-1111-4111-8111-111111111111';
  const target=path.join(storage.root,'tmp',`upload-${id}`);fs.writeFileSync(target,'existing');
  const original=crypto.randomUUID;crypto.randomUUID=()=>id;
  try {assert.equal((await call('owner','POST',`/${team}/pages`,form())).status,500);}
  finally {crypto.randomUUID=original;}
  assert.equal(fs.readFileSync(target,'utf8'),'existing');
});

test('HTTP concurrent uploads reserve before staging and retain history in quota usage', async t => {
  const { team, call, form, db, storage } = await setup(t);
  db.prepare('INSERT INTO workspace_quotas VALUES (?,?,?,?)').run(team,1,1024*1024,1024);
  let resume; const gate=new Promise(resolve=>{resume=resolve}); let staged;
  const entered=new Promise(resolve=>{staged=resolve}); const original=storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml=async args=>{staged(); await gate; return original(args);};
  const first=call('owner','POST',`/${team}/pages`,form('one'));
  await entered;
  const second=await call('editor','POST',`/${team}/pages`,form('two'));
  assert.equal(second.status, 409); assert.equal(second.body.code,'QUOTA_EXCEEDED'); assert.equal(second.body.reason,'apps');
  resume(); const created=await first; assert.equal(created.status,201);
  const replaced=await call('owner','POST',`/${team}/pages/${created.body.page.id}/replace`,form('two','index.html',{revision:'0'}));
  assert.equal(replaced.status,200);
  assert.equal(db.prepare('SELECT sum(size_bytes) n FROM workspace_page_releases').get().n,6);
  db.prepare('UPDATE workspace_quotas SET max_storage_bytes=6,max_upload_bytes=1 WHERE workspace_id=?').run(team);
  const denied=await call('owner','POST',`/${team}/pages/${created.body.page.id}/replace`,form('x','index.html',{revision:'1'}));
  assert.equal(denied.status,409); assert.equal(denied.body.code,'QUOTA_EXCEEDED');
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
});

test('stream cap and revoked access clean reservations and temporary files', async t => {
  const { root, team, call, form, db, storage }=await setup(t);
  db.prepare('INSERT INTO workspace_quotas VALUES (?,?,?,?)').run(team,3,200*1024*1024,4);
  let r=await call('editor','POST',`/${team}/pages`,form('12345'));
  assert.equal(r.status,413);
  const original=storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml=async args=>{const result=await original(args); db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(team,'editor'); return result;};
  r=await call('editor','POST',`/${team}/pages`,form('1234'));
  assert.equal(r.status,403);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
  assert.deepEqual(await fs.promises.readdir(path.join(root,'storage','sites')),[]);
});

test('the existing platform upload cap remains effective alongside workspace quotas', async t => {
  const {team,call,form,db}=await setup(t,{platformLimit:2});
  const r=await call('owner','POST',`/${team}/pages`,form('123'));
  assert.equal(r.status,413); assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
});

test('dynamic platform defaults and admin override affect real workspace uploads', async t => {
  let defaults={maxApps:2,maxStorageBytes:1000,maxUploadBytes:2};
  const {team,call,form,db}=await setup(t,{quotaDefaults:()=>defaults});
  const base=`/${team}/pages`;
  assert.equal((await call('owner','POST',base,form('123'))).status,413);
  defaults={maxApps:1,maxStorageBytes:1000,maxUploadBytes:4};
  const first=await call('owner','POST',base,form('123')); assert.equal(first.status,201);
  assert.equal((await call('owner','POST',base,form('1'))).status,409);
  const admin=createWorkspaceQuotaService({db,defaultLimits:()=>defaults,authorize:(workspace,actor,action)=>{
    if (actor!=='platform-admin' || !['view','manage'].includes(action)) throw Object.assign(Error('denied'),{code:'FORBIDDEN'});
  }});
  assert.throws(()=>admin.update(team,'owner',{maxApps:2,maxStorageBytes:1000,maxUploadBytes:4}),e=>e.code==='FORBIDDEN');
  admin.update(team,'platform-admin',{maxApps:2,maxStorageBytes:1000,maxUploadBytes:4});
  defaults={maxApps:0,maxStorageBytes:0,maxUploadBytes:0};
  assert.equal((await call('owner','POST',base,form('1'))).status,201);
  assert.equal((await call('owner','POST',base,form('1'))).status,409);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages WHERE workspace_id=?').get(team).n,2);
});

test('expired upload cannot publish, and retains no reservation or metadata', async t => {
  let now=1000; const {root,team,call,form,db,storage}=await setup(t,{clock:()=>now});
  const original=storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml=async args=>{const release=await original(args); now+=60*60*1000; return release;};
  const result=await call('owner','POST',`/${team}/pages`,form('test'));
  assert.equal(result.status,409); assert.equal(result.body.code,'EXPIRED');
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
  assert.deepEqual(await fs.promises.readdir(path.join(root,'storage','sites')),[]);
});

test('ZIP raw upload cap is independent from its expanded storage reservation', async t => {
  const {team,call,form,db}=await setup(t); const zip=new JSZip(); zip.file('index.html','hello');
  const payload=await zip.generateAsync({type:'nodebuffer'});
  db.prepare('INSERT INTO workspace_quotas VALUES (?,?,?,?)').run(team,2,100*1024*1024,payload.length);
  const result=await call('owner','POST',`/${team}/pages`,form(payload,'site.zip'));
  assert.equal(result.status,201); assert.equal(result.body.page.sizeBytes,5);
  assert.equal((await call('owner','POST',`/${team}/pages`,form(payload,'site.zip'))).status,201);
  const denied=await call('owner','POST',`/${team}/pages`,form(payload,'site.zip'));
  assert.equal(denied.status,409); assert.equal(denied.body.code,'QUOTA_EXCEEDED');
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
});

test('small ZIPs fit small quotas and expanded uploads cannot exceed reserved space',async t=>{
 const {team,call,form,db,root}=await setup(t),base=`/${team}/pages`;
 db.prepare('INSERT INTO workspace_quotas VALUES (?,?,?,?)').run(team,2,1024,1024);
 const makeZip=async text=>{const zip=new JSZip();zip.file('index.html',text);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});};
 const first=await call('owner','POST',base,form(await makeZip('four'),'small.zip'));
 assert.equal(first.status,201);const page=first.body.page;
 const route=`${base}/${page.id}`;
 const tooLarge=await call('editor','POST',`${route}/replace`,form(await makeZip('x'.repeat(1021)),'large.zip',{revision:'0'}));
 assert.equal(tooLarge.status,409);assert.equal(tooLarge.body.code,'QUOTA_EXCEEDED');assert.equal(tooLarge.body.reason,'storage');
 assert.equal((await call('owner','GET',route)).body.page.releaseId,page.releaseId);
 assert.equal(fs.readFileSync(path.join(root,'storage','sites',page.id,'releases',page.releaseId,'index.html'),'utf8'),'four');
 assert.equal((await call('editor','POST',`${route}/replace`,form(await makeZip('x'.repeat(1020)),'fits.zip',{revision:'0'}))).status,200);
 assert.equal(db.prepare('SELECT sum(size_bytes) n FROM workspace_page_releases').get().n,1024);
 assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
});

test('chunked multipart without Content-Length is capped while streaming', async t => {
  const {team,port,db,root}=await setup(t);
  db.prepare('INSERT INTO workspace_quotas VALUES (?,?,?,?)').run(team,1,10,4);
  const send=content=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:`/workspaces/${team}/pages`,method:'POST',headers:{'x-user':'owner','content-type':'multipart/form-data; boundary=quota-test','transfer-encoding':'chunked'}},res=>{
      let text=''; res.on('data',x=>text+=x); res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
    });
    req.on('error',reject);
    req.write('--quota-test\r\nContent-Disposition: form-data; name="title"\r\n\r\nTest\r\n--quota-test\r\nContent-Disposition: form-data; name="file"; filename="a.html"\r\nContent-Type: text/html\r\n\r\n');
    req.write(content); req.end('\r\n--quota-test--\r\n');
  });
  assert.equal((await send('12345')).status,413);
  assert.equal((await send('1234')).status,201);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n,0);
  assert.deepEqual(await fs.promises.readdir(path.join(root,'storage','tmp')),[]);
});

test('aborted streamed upload stops writing before its reservation is released', async t => {
  const {team,port,db,root}=await setup(t);
  const req=http.request({host:'127.0.0.1',port,path:`/workspaces/${team}/pages`,method:'POST',headers:{'x-user':'owner','content-type':'multipart/form-data; boundary=abort-test','transfer-encoding':'chunked'}});
  req.on('error',()=>{});
  req.write('--abort-test\r\nContent-Disposition: form-data; name="file"; filename="a.html"\r\nContent-Type: text/html\r\n\r\n1234');
  const waitFor=async predicate=>{for(let i=0;i<100;i++){if(await predicate()) return; await new Promise(resolve=>setTimeout(resolve,20));} throw Error('timed out waiting for upload cleanup');};
  await waitFor(()=>db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n===1);
  req.destroy();
  await waitFor(async()=>db.prepare('SELECT count(*) n FROM workspace_quota_reservations').get().n===0 && (await fs.promises.readdir(path.join(root,'storage','tmp'))).length===0);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,0);
});

test('cleanup failure after a successful replacement does not report a false failure', async t => {
  const {team,call,form,storage}=await setup(t); const base=`/${team}/pages`;
  const page=(await call('owner','POST',base,form())).body.page;
  storage.removePage=async()=>{throw Error('cleanup failed')};
  const result=await call('owner','POST',`${base}/${page.id}/replace`,form('new','a.html',{revision:'0'}));
  assert.equal(result.status,200); assert.equal(result.body.page.revision,1);
});

test('HTTP pages enforce workspace roles, isolation, metadata and real HTML/ZIP files', async t => {
  const { root, team, other, call, form, db } = await setup(t);
  const base = `/${team}/pages`;
  assert.equal((await call('outsider', 'GET', base)).status, 403);
  assert.equal((await call('viewer', 'POST', base, form())).status, 403);
  let r = await call('editor', 'POST', base, form()); assert.equal(r.status, 201);
  const page = r.body.page; assert.equal(page.accessMode, 'private'); assert.match(page.id, /^[a-z0-9-]+$/);
  assert.doesNotMatch(JSON.stringify(page), /releaseDir|sourcePath|url|<h1>/);
  assert.equal((await call('viewer', 'GET', `${base}/${page.id}`)).status, 200);
  assert.equal((await call('viewer', 'GET', base)).body.pages.length, 1);
  assert.equal((await call('viewer', 'PATCH', `${base}/${page.id}`, { title: 'bad' })).status, 403);
  assert.equal((await call('editor', 'PATCH', `${base}/${page.id}`, { title: 'Changed' })).status, 200);
  assert.equal((await call('editor', 'PATCH', `${base}/${page.id}`, { accessMode: 'private' })).status, 403);
  assert.equal((await call('owner', 'PATCH', `${base}/${page.id}`, { accessMode: 'public' })).status, 400);
  assert.equal((await call('owner', 'PATCH', `${base}/${page.id}`, { accessMode: 'private' })).status, 200);
  assert.equal((await call('owner', 'GET', `/${other}/pages/${page.id}`)).status, 403);
  assert.equal((await call('outsider', 'GET', `/${other}/pages/${page.id}`)).status, 404);
  assert.equal((await call('outsider', 'DELETE', `/${other}/pages/${page.id}`)).status, 404);
  const row = db.prepare('SELECT * FROM workspace_pages WHERE id=?').get(page.id);
  assert.equal(await fs.promises.readFile(path.join(root, 'storage', 'sites', row.storage_id, 'releases', row.release_id, 'index.html'), 'utf8'), '<h1>hello</h1>');
  const zip = new JSZip(); zip.file('bundle/index.html', 'zip'); zip.file('bundle/css/a.css', 'a');
  r = await call('owner', 'POST', base, form(await zip.generateAsync({ type: 'nodebuffer' }), 'site.zip')); assert.equal(r.status, 201);
  const zipRow = db.prepare('SELECT * FROM workspace_pages WHERE id=?').get(r.body.page.id);
  assert.equal(await fs.promises.readFile(path.join(root, 'storage', 'sites', zipRow.storage_id, 'releases', zipRow.release_id, 'css', 'a.css'), 'utf8'), 'a');
  assert.equal((await call('editor', 'DELETE', `${base}/${page.id}`)).status, 403);
  assert.equal((await call('owner', 'DELETE', `${base}/${page.id}`)).status, 204);
  assert.equal(fs.existsSync(path.join(root, 'storage', 'sites', row.storage_id)), false);
  assert.equal((await call('owner', 'GET', `${base}/${page.id}`)).status, 404);
});

test('migration backfills existing v6 pages with current version and revision', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY);'); db.exec(workspaceSchema); db.exec(workspacePagesSchema);
    db.exec("INSERT INTO users VALUES ('u'); INSERT INTO workspaces VALUES ('ws','Team','team','u','now'); INSERT INTO workspace_page_ids VALUES ('w-0123456789abcdef0123456789abcdef'); INSERT INTO workspace_pages VALUES ('w-0123456789abcdef0123456789abcdef','ws','u','Old','private','w-0123456789abcdef0123456789abcdef','1-aaaaaaaaaa','index.html','html','old.html',3,1,'created','updated');");
    db.exec(workspacePageReleasesMigrationSql);
    const r = db.prepare('SELECT * FROM workspace_page_releases').get();
    assert.equal(r.release_id, '1-aaaaaaaaaa'); assert.equal(r.entry_file, 'index.html'); assert.equal(r.created_at, 'updated');
    assert.equal(db.prepare('SELECT revision FROM workspace_page_revisions').get().revision, 0);
  } finally { db.close(); }
});

test('replace and activate preserve history, metadata, authorization and detect ABA', async t => {
  const { root, team, other, call, form, db } = await setup(t); const base = `/${team}/pages`;
  const created = await call('owner', 'POST', base, form('original', 'old.html')); const page = created.body.page;
  assert.equal(page.revision, 0); const id = page.id, route = `${base}/${id}`;
  const initial = await call('viewer', 'GET', `${route}/releases`); assert.equal(initial.body.releases.length, 1);
  const old = initial.body.releases[0]; assert.equal(old.current, true); assert.equal(old.originalFilename, 'old.html');
  assert.equal((await call('viewer', 'POST', `${route}/replace`, form('x', 'x.html', { revision: '0' }))).status, 403);
  let r = await call('editor', 'POST', `${route}/replace`, form('replacement', 'new.html', { revision: '0', entryFile: 'new.html' }));
  assert.equal(r.status, 200); assert.equal(r.body.page.revision, 1); assert.equal(r.body.page.entryFile, 'new.html');
  const current = r.body.page.releaseId;
  r = await call('viewer', 'GET', `${route}/releases`); assert.equal(r.body.releases.length, 2);
  assert.equal(r.body.releases.find(x => x.releaseId === current).current, true);
  assert.equal((await call('outsider', 'GET', `/${other}/pages/${id}/releases`)).status, 404);
  assert.equal((await call('viewer', 'POST', `${route}/releases/${old.releaseId}/activate`, { revision: 1 })).status, 403);
  r = await call('editor', 'POST', `${route}/releases/${old.releaseId}/activate`, { revision: 1 });
  assert.equal(r.body.page.revision, 2); assert.equal(r.body.page.originalFilename, 'old.html'); assert.equal(r.body.page.sizeBytes, 8); assert.equal(r.body.page.entryFile, 'index.html');
  r = await call('editor', 'POST', `${route}/releases/${current}/activate`, { revision: 2 });
  assert.equal(r.body.page.revision, 3); assert.equal(r.body.page.originalFilename, 'new.html'); assert.equal(r.body.page.entryFile, 'new.html');
  assert.equal((await call('editor', 'POST', `${route}/replace`, form('stale', 'stale.html', { revision: '1' }))).status, 409);
  assert.equal((await call('editor', 'POST', `${route}/releases/${current}/activate`, { revision: 1 })).status, 409);
  assert.equal((await call('editor', 'POST', `${route}/releases/${current}/activate`, { revision: 3 })).body.page.revision, 4);
  assert.equal((await call('editor', 'POST', `${route}/releases/no-such/activate`, { revision: 4 })).status, 404);
  const releases = db.prepare('SELECT * FROM workspace_page_releases WHERE page_id=?').all(id);
  for (const x of releases) assert.equal(fs.existsSync(path.join(root, 'storage', 'sites', id, 'releases', x.release_id, x.entry_file)), true);
});

test('replacement in flight conflicts after ABA even when active release matches again', async t => {
  const { root, team, call, form, storage } = await setup(t); const base = `/${team}/pages`;
  const page = (await call('owner', 'POST', base, form('old', 'old.html'))).body.page; const route = `${base}/${page.id}`;
  const second = (await call('editor', 'POST', `${route}/replace`, form('second', 'second.html', { revision: '0' }))).body.page;
  const originalStage = storage.stageSingleHtml.bind(storage);
  let entered, resume; const enteredPromise = new Promise(resolve => { entered = resolve; }); const resumePromise = new Promise(resolve => { resume = resolve; });
  storage.stageSingleHtml = async args => { const result = await originalStage(args); entered(); await resumePromise; return result; };
  const pending = call('editor', 'POST', `${route}/replace`, form('pending', 'pending.html', { revision: '1' }));
  await enteredPromise;
  assert.equal((await call('owner', 'POST', `${route}/releases/${page.releaseId}/activate`, { revision: 1 })).status, 200);
  assert.equal((await call('owner', 'POST', `${route}/releases/${second.releaseId}/activate`, { revision: 2 })).status, 200);
  resume(); assert.equal((await pending).status, 409);
  assert.equal((await call('viewer', 'GET', route)).body.page.releaseId, second.releaseId);
  assert.equal((await call('viewer', 'GET', `${route}/releases`)).body.releases.length, 2);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'storage', 'sites')), [page.id]);
});

test('cross-page and cross-workspace release IDs are rejected and old versions are retained', async t => {
  const { team, other, call, form } = await setup(t); const base = `/${team}/pages`;
  let page = (await call('owner', 'POST', base, form())).body.page;
  const otherPage = (await call('outsider', 'POST', `/${other}/pages`, form())).body.page;
  const route = `${base}/${page.id}`;
  assert.equal((await call('owner', 'POST', `${route}/releases/${otherPage.releaseId}/activate`, { revision: 0 })).status, 404);
  assert.equal((await call('outsider', 'POST', `/${other}/pages/${page.id}/replace`, form('x', 'x.html', { revision: '0' }))).status, 404);
  for (let i = 0; i < 6; i++) {
    const r = await call('editor', 'POST', `${route}/replace`, form(`version ${i}`, 'version.html', { revision: String(page.revision) }));
    assert.equal(r.status, 200); page = r.body.page;
  }
  const history = await call('viewer', 'GET', `${route}/releases`);
  assert.equal(history.body.releases.length, 7);
  assert.equal(history.body.releases.filter(x => x.current).length, 1);
});

test('replacement rechecks permission after staging and keeps old version', async t => {
  const { root, team, call, form, db, storage } = await setup(t); const base = `/${team}/pages`;
  const page = (await call('owner', 'POST', base, form())).body.page;
  const stage = storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml = async args => { const result = await stage(args); db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(team, 'editor'); return result; };
  assert.equal((await call('editor', 'POST', `${base}/${page.id}/replace`, form('new', 'new.html', { revision: '0' }))).status, 403);
  assert.equal((await call('editor', 'POST', `${base}/${page.id}/releases/${page.releaseId}/activate`, { revision: 0 })).status, 403);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_page_releases WHERE page_id=?').get(page.id).n, 1);
  assert.equal((await call('owner', 'GET', `${base}/${page.id}`)).body.page.revision, 0);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'storage', 'sites')), [page.id]);
});

test('ZIP replacement records its own entry, size and files', async t => {
  const { root, team, call, form, db } = await setup(t); const base = `/${team}/pages`;
  const page = (await call('owner', 'POST', base, form())).body.page;
  const zip = new JSZip(); zip.file('bundle/home.html', 'hello'); zip.file('bundle/css/main.css', 'body{}');
  const result = await call('editor', 'POST', `${base}/${page.id}/replace`, form(await zip.generateAsync({ type: 'nodebuffer' }), 'bundle.zip', { revision: '0', entryFile: 'home.html' }));
  assert.equal(result.status, 200); assert.equal(result.body.page.sourceType, 'zip');
  assert.equal(result.body.page.fileCount, 2); assert.equal(result.body.page.sizeBytes, 11);
  const row = db.prepare('SELECT * FROM workspace_pages WHERE id=?').get(page.id);
  assert.equal(await fs.promises.readFile(path.join(root, 'storage', 'sites', page.id, 'releases', row.release_id, 'home.html'), 'utf8'), 'hello');
});

test('cleanup failure reports failure and leaves an isolated recoverable staging directory', async t => {
  const { root, team, call, form, db, storage } = await setup(t); const base = `/${team}/pages`;
  const page = (await call('owner', 'POST', base, form())).body.page;
  const stage = storage.stageSingleHtml.bind(storage), remove = storage.removePage.bind(storage);
  storage.stageSingleHtml = async args => { await stage(args); throw new Error('write failed'); };
  storage.removePage = async () => { throw new Error('cleanup failed'); };
  assert.equal((await call('editor', 'POST', `${base}/${page.id}/replace`, form('x', 'x.html', { revision: '0' }))).status, 500);
  const dirs = await fs.promises.readdir(path.join(root, 'storage', 'sites'));
  const orphan = dirs.find(id => id !== page.id); assert.ok(orphan);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages WHERE storage_id=?').get(orphan).n, 0);
  assert.equal((await call('viewer', 'GET', `${base}/${page.id}`)).body.page.releaseId, page.releaseId);
  await remove(orphan);
});

test('failed replacement or missing release leaves original active and intact', async t => {
  const { root, team, call, form, db, storage } = await setup(t); const base = `/${team}/pages`;
  const page = (await call('owner', 'POST', base, form())).body.page; const route = `${base}/${page.id}`;
  const stage = storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml = async args => { await stage(args); throw new Error('interrupted'); };
  assert.equal((await call('editor', 'POST', `${route}/replace`, form('new', 'new.html', { revision: '0' }))).status, 500);
  storage.stageSingleHtml = stage;
  db.exec("CREATE TRIGGER reject_release BEFORE INSERT ON workspace_page_releases BEGIN SELECT RAISE(ABORT,'failed'); END;");
  assert.equal((await call('editor', 'POST', `${route}/replace`, form('new', 'new.html', { revision: '0' }))).status, 500);
  db.exec('DROP TRIGGER reject_release');
  assert.equal((await call('owner', 'GET', route)).body.page.revision, 0);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'storage', 'sites')), [page.id]);
  const row = db.prepare('SELECT * FROM workspace_pages WHERE id=?').get(page.id);
  await fs.promises.rm(path.join(root, 'storage', 'sites', page.id, 'releases', row.release_id, row.entry_file));
  assert.equal((await call('editor', 'POST', `${route}/releases/${row.release_id}/activate`, { revision: 0 })).status, 409);
  assert.equal((await call('owner', 'GET', route)).body.page.revision, 0);
});

test('failed uploads clean files and reject unsafe entry paths', async t => {
  const { root, team, call, form, db } = await setup(t); const base = `/${team}/pages`;
  assert.equal((await call('owner', 'POST', base, form('x', 'index.html', { entryFile: '../outside.html' }))).status, 400);
  assert.equal((await call('owner', 'POST', base, form('not zip', 'bad.zip'))).status, 400);
  const zip = new JSZip(); zip.file('index.html', 'safe'); zip.file('../escape.txt', 'unsafe');
  assert.equal((await call('owner', 'POST', base, form(await zip.generateAsync({ type: 'nodebuffer' }), 'traversal.zip'))).status, 400);
  const unsafe = new JSZip(); unsafe.file('index.html', 'safe'); unsafe.file('assets/file:stream', 'unsafe');
  assert.equal((await call('owner', 'POST', base, form(await unsafe.generateAsync({ type: 'nodebuffer' }), 'unsafe.zip'))).status, 400);
  assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspace_pages').get().n, 0);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'uploads')), []);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'storage', 'sites')), []);
});

test('missing page files fail deletion without deleting database metadata', async t => {
  const { root, team, call, form, db } = await setup(t); const base = `/${team}/pages`;
  const created = await call('owner', 'POST', base, form()); const id = created.body.page.id;
  await fs.promises.rm(path.join(root, 'storage', 'sites', id), { recursive: true });
  assert.equal((await call('owner', 'DELETE', `${base}/${id}`)).status, 500);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspace_pages WHERE id=?').get(id).n, 1);
});

test('revoked editor cannot commit an upload after staging', async t => {
  const { root, team, call, form, db, storage } = await setup(t);
  const stage = storage.stageSingleHtml.bind(storage);
  storage.stageSingleHtml = async args => {
    const release = await stage(args);
    db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(team, 'editor');
    return release;
  };
  assert.equal((await call('editor', 'POST', `/${team}/pages`, form())).status, 403);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspace_pages').get().n, 0);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'storage', 'sites')), []);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'uploads')), []);
});

test('database failures remove staged uploads and restore files on delete rollback', async t => {
  const { root, team, call, form, db } = await setup(t); const base = `/${team}/pages`;
  db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON workspace_pages BEGIN SELECT RAISE(ABORT,'insert failed'); END;");
  assert.equal((await call('owner', 'POST', base, form())).status, 500);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'storage', 'sites')), []);
  db.exec('DROP TRIGGER fail_insert');
  const created = await call('owner', 'POST', base, form()); assert.equal(created.status, 201);
  const id = created.body.page.id;
  db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON workspace_pages BEGIN SELECT RAISE(ABORT,'delete failed'); END;");
  assert.equal((await call('owner', 'DELETE', `${base}/${id}`)).status, 500);
  assert.equal((await call('owner', 'GET', `${base}/${id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(root, 'storage', 'sites', id)), true);
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'storage', 'sites')), [id]);
});
