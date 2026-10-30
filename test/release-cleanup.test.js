import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/database.js';
import { createReleaseCleanup } from '../server/release-cleanup.js';
import { createWorkspaceQuotaService } from '../server/workspace-pages.js';

test('deleting history protects the active release and recovers an interrupted cleanup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hostlet-releases-'));
  const db = openDatabase(':memory:');
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES ('u','u@example.org','hash','now')");
  db.exec("INSERT INTO workspaces VALUES ('s','Space','personal','u','now'); INSERT INTO workspace_members VALUES ('s','u','owner','now')");
  const id = 'w-' + 'a'.repeat(32), old = '1-aaaaaaaaaa', current = '2-bbbbbbbbbb';
  db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(id);
  db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'s','u','title','private',id,current,'index.html','html','index.html',1,1,'now','now');
  db.prepare('INSERT INTO workspace_page_revisions VALUES (?,0)').run(id);
  for (const release of [old,current]) {
    db.prepare('INSERT INTO workspace_page_releases VALUES (?,?,?,?,?,?,?,?)').run(id,release,'index.html','html','index.html',1,1,'now');
    const dir=path.join(root,'sites',id,'releases',release); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'index.html'),release);
  }
  const authorize = (space, user, permission) => { if (space !== 's' || user !== 'u' || permission !== 'edit') throw Object.assign(Error('forbidden'),{code:'FORBIDDEN'}); };
  const service=createReleaseCleanup({db,storageRoot:root,authorize,onCommitted:()=>{throw Error('simulated crash');}});
  assert.throws(()=>service.remove('s','u',id,current,0),e=>e.code==='CONFLICT');
  assert.throws(()=>service.remove('s','other',id,old,0),e=>e.code==='FORBIDDEN');
  assert.throws(()=>service.remove('s','u',id,old,0),/simulated crash/);
  assert.ok(fs.existsSync(path.join(root,'sites',id,'releases',old)));
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_release_cleanup').get().n,1);
  assert.equal(db.prepare('SELECT sum(size_bytes) n FROM workspace_release_cleanup').get().n,1);
  const quota=createWorkspaceQuotaService({db,authorize:()=>{},defaultLimits:()=>({maxApps:2,maxStorageBytes:2,maxUploadBytes:2})});
  assert.throws(()=>quota.reserve('s','u',{apps:0,bytes:1,ttlMs:1000}),e=>e.code==='QUOTA_EXCEEDED');
  const otherRoot=path.join(root,'other'); fs.mkdirSync(otherRoot);
  assert.throws(()=>createReleaseCleanup({db,storageRoot:otherRoot,authorize}).recover(),/storage root/);
  createReleaseCleanup({db,storageRoot:root,authorize}).recover();
  assert.equal(fs.existsSync(path.join(root,'sites',id,'releases',old)),false);
  assert.ok(fs.existsSync(path.join(root,'sites',id,'releases',current)));
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_release_cleanup').get().n,0);
  assert.ok(quota.reserve('s','u',{apps:0,bytes:1,ttlMs:1000}).id);
});
