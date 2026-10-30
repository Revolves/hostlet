import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_QUOTAS } from './quotas.js';
import { validateRelativeFile, validateTitle } from './validation.js';

const legacyId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const releaseId=/^[0-9]+-[a-f0-9]{10}$/;
const safeInteger=n=>Number.isSafeInteger(n)&&n>=0;
const validPart=s=>s && !/[\x00-\x1f\x7f<>:"|?*\\]/.test(s) && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s);
const workspacePageId=/^w-[a-f0-9]{32}$/;

export const legacyMigrationSchema = `
CREATE TABLE legacy_migration_journal (legacy_id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE, storage_root TEXT NOT NULL);
CREATE TABLE legacy_migration_map (legacy_id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, access_mode TEXT NOT NULL CHECK(access_mode IN ('public','private')));
`;

function personalWorkspace(db,accountId) {
  const owner=db.prepare("SELECT w.id FROM users u JOIN workspaces w ON w.created_by=u.id AND w.type='personal' JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id AND m.role='owner' WHERE u.id=? AND u.email_verified_at IS NOT NULL").get(accountId);
  if(!owner) throw new Error('Verified account and personal workspace required');
  return owner.id;
}

function verifyAncestors(dir) {
  for(let current=dir;;current=path.dirname(current)) {
    const stat=fs.lstatSync(current);
    if(stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe storage path');
    if(path.dirname(current)===current) break;
  }
}
function inspectRelease(dir, entry) {
  let files=0,bytes=0,found=false;const digest=createHash('sha256');
  function visit(base,relative='') {
    for(const name of fs.readdirSync(base).sort()) {
      if(!validPart(name) || name==='.' || name==='..') throw new Error('Unsafe file path');
      const rel=relative ? `${relative}/${name}` : name, current=path.join(base,name),stat=fs.lstatSync(current);
      if(stat.isSymbolicLink()) throw new Error('Unsafe file path');
      if(stat.isDirectory()) { digest.update(JSON.stringify(['dir',rel]));visit(current,rel); }
      else if(stat.isFile()) {
        files++;bytes+=stat.size;if(!safeInteger(bytes))throw new Error('Invalid file size');if(rel===entry)found=true;
        const fileHash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536),fd=fs.openSync(current,'r');
        try {for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;fileHash.update(buffer.subarray(0,count));}} finally {fs.closeSync(fd);}
        digest.update(JSON.stringify(['file',rel,stat.size,fileHash.digest('hex')]));
      }
      else throw new Error('Unsafe file path');
    }
  }
  verifyAncestors(dir); visit(dir);
  if(!found) throw new Error('Entry file missing');
  return {files,bytes,digest:digest.digest('hex')};
}

/** Read-only preflight. Caller must stop all services and other writers and
 * hold the data-directory instance lock for this check and any later migration.
 * No passwords, grants, or account tokens are read or copied. */
export function inspectLegacyMigration({db,dataDir,accountId,pageIds}={}) {
  if(!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1 || !path.isAbsolute(dataDir || '') || typeof accountId!=='string' || !accountId || !Array.isArray(pageIds) || !pageIds.length || pageIds.length>1000 || new Set(pageIds).size!==pageIds.length || pageIds.some(id=>!legacyId.test(id || ''))) throw new Error('Invalid migration selection');
  const workspaceId=personalWorkspace(db,accountId);
  if(db.prepare('SELECT 1 FROM workspace_quota_reservations WHERE workspace_id=? LIMIT 1').get(workspaceId)) throw new Error('Pending workspace quota reservation');
  const override=db.prepare('SELECT max_apps AS maxApps,max_storage_bytes AS maxStorageBytes,max_upload_bytes AS maxUploadBytes FROM workspace_quotas WHERE workspace_id=?').get(workspaceId);
  const settings=db.prepare('SELECT value FROM platform_settings WHERE id=1').get();
  const limits=override || (settings ? JSON.parse(settings.value).defaultQuotas : DEFAULT_QUOTAS);
  if(!limits || !['maxApps','maxStorageBytes','maxUploadBytes'].every(k=>safeInteger(limits[k]))) throw new Error('Invalid workspace quota');
  const used=db.prepare(`SELECT (SELECT count(*) FROM workspace_pages WHERE workspace_id=?) apps,
    COALESCE((SELECT sum(r.size_bytes) FROM workspace_page_releases r JOIN workspace_pages p ON p.id=r.page_id WHERE p.workspace_id=?),0) +
    COALESCE((SELECT sum(size_bytes) FROM workspace_release_cleanup WHERE workspace_id=?),0) bytes`).get(workspaceId,workspaceId,workspaceId);
  if(!safeInteger(used.apps)||!safeInteger(used.bytes)) throw new Error('Invalid workspace usage');
  let added=0;
  const pages=pageIds.map(id=>{
    const page=db.prepare('SELECT * FROM pages WHERE id=?').get(id);
    if(!page || !['public','private'].includes(page.access_mode)) throw new Error('Legacy page not found or invalid');
    validateTitle(page.title);
    const releases=db.prepare('SELECT * FROM page_releases WHERE page_id=? ORDER BY created_at,release_id').all(id);
    if(!releases.length || releases.length>20) throw new Error('Invalid release history');
    let sizeBytes=0,current=false;
    const checked=releases.map(release=>{
      if(!releaseId.test(release.release_id) || !['html','zip'].includes(release.source_type) || !safeInteger(release.size_bytes) || !safeInteger(release.file_count) || release.file_count<1) throw new Error('Invalid release metadata');
      const expected=path.join(path.resolve(dataDir),'storage','sites',id,'releases',release.release_id);
      if(!path.isAbsolute(release.release_dir || '') || path.resolve(release.release_dir)!==expected) throw new Error('Invalid release path');
      const entry=validateRelativeFile(release.entry_file,{htmlOnly:true});
      if(entry.split('/').some(s=>!validPart(s))) throw new Error('Unsafe entry path');
      const inspected=inspectRelease(expected,entry);
      if(inspected.bytes!==release.size_bytes || inspected.files!==release.file_count) throw new Error('Release size or file metadata mismatch');
      if(release.release_id===page.release_id){
        if(page.release_dir!==release.release_dir || page.entry_file!==release.entry_file || page.size_bytes!==release.size_bytes || page.file_count!==release.file_count || page.source_type!==release.source_type) throw new Error('Current release metadata mismatch');
        current=true;
      }
      sizeBytes+=release.size_bytes;if(!safeInteger(sizeBytes)) throw new Error('Invalid release size');
      return {releaseId:release.release_id,entryFile:entry,sourceType:release.source_type,originalFilename:release.original_filename,sizeBytes:release.size_bytes,fileCount:release.file_count,createdAt:release.created_at,sourceDir:expected,digest:inspected.digest};
    });
    if(!current) throw new Error('Current release missing');
    added+=sizeBytes;if(!safeInteger(added)) throw new Error('Invalid release size');
    return {legacyId:id,title:page.title,slug:page.slug,accessMode:page.access_mode,currentReleaseId:page.release_id,createdAt:page.created_at,sizeBytes,releases:checked};
  });
  if(BigInt(used.apps)+BigInt(pages.length)>BigInt(limits.maxApps) || BigInt(used.bytes)+BigInt(added)>BigInt(limits.maxStorageBytes)) throw new Error('Workspace quota exceeded');
  return {accountId,workspaceId,pages};
}

// Checks the selected pages, their files and target account against a separate
// offline backup. Operators must still verify the complete backup and config.
export function verifyLegacyMigrationBackup({db,dataDir,backupDir,plan}={}) {
  if(!db||!path.isAbsolute(dataDir||'')||!path.isAbsolute(backupDir||'')||!plan||!Array.isArray(plan.pages)||!plan.pages.length)throw new Error('Invalid backup request');
  const source=fs.realpathSync(dataDir),backup=fs.realpathSync(backupDir);
  const inside=(parent,child)=>{const rel=path.relative(parent,child);return rel==='' || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel));};
  if(inside(source,backup)||inside(backup,source))throw new Error('Backup must be separate from the data directory');
  verifyAncestors(backup);
  const file=path.join(backup,'hostlet.sqlite'),stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Invalid backup database');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-backup-check-'));let snapshot;
  try {
    const copy=path.join(temporary,'hostlet.sqlite');fs.copyFileSync(file,copy,fs.constants.COPYFILE_EXCL);
    try {const wal=fs.lstatSync(file+'-wal');if(wal.isSymbolicLink()||!wal.isFile())throw new Error('Invalid backup WAL');fs.copyFileSync(file+'-wal',copy+'-wal',fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='ENOENT')throw error;}
    snapshot=new DatabaseSync(copy,{readOnly:true});
    if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||snapshot.prepare('PRAGMA foreign_key_check').all().length||snapshot.prepare('PRAGMA user_version').get().user_version!==db.prepare('PRAGMA user_version').get().user_version)throw new Error('Invalid backup database');
    const equal=(sql,...args)=>JSON.stringify(db.prepare(sql).all(...args))===JSON.stringify(snapshot.prepare(sql).all(...args));
    if(!equal('SELECT * FROM users WHERE id=?',plan.accountId)||!equal('SELECT * FROM workspaces WHERE id=?',plan.workspaceId)||!equal('SELECT * FROM workspace_members WHERE workspace_id=? ORDER BY user_id',plan.workspaceId))throw new Error('Backup account or workspace differs');
    for(const page of plan.pages){
      if(!legacyId.test(page.legacyId)||!equal('SELECT * FROM pages WHERE id=?',page.legacyId)||!equal('SELECT * FROM page_releases WHERE page_id=? ORDER BY release_id',page.legacyId))throw new Error('Backup page metadata differs');
      for(const release of page.releases){
        if(!releaseId.test(release.releaseId))throw new Error('Invalid backup release');
        const dir=path.join(backup,'storage','sites',page.legacyId,'releases',release.releaseId),checked=inspectRelease(dir,release.entryFile);
        if(checked.bytes!==release.sizeBytes||checked.files!==release.fileCount||checked.digest!==release.digest)throw new Error('Backup release differs');
      }
    }
    return true;
  } finally { if(snapshot)snapshot.close();fs.rmSync(temporary,{recursive:true,force:true}); }
}

function ensureSafeDirectory(dir) {
  try { const stat=fs.lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe storage path'); }
  catch(error) { if(error.code!=='ENOENT')throw error;fs.mkdirSync(dir); }
}
function safeTree(dir) {
  const stat=fs.lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe migration directory');
  for(const name of fs.readdirSync(dir)) {
    if(!validPart(name))throw new Error('Unsafe migration path');
    const child=path.join(dir,name),item=fs.lstatSync(child);
    if(item.isSymbolicLink())throw new Error('Unsafe migration path');
    if(item.isDirectory())safeTree(child);else if(!item.isFile())throw new Error('Unsafe migration path');
  }
}
function copyTree(source,destination) {
  fs.mkdirSync(destination);
  for(const name of fs.readdirSync(source)) {
    if(!validPart(name))throw new Error('Unsafe migration path');
    const from=path.join(source,name),to=path.join(destination,name),stat=fs.lstatSync(from);
    if(stat.isSymbolicLink())throw new Error('Unsafe migration path');
    if(stat.isDirectory())copyTree(from,to);
    else if(stat.isFile())fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
    else throw new Error('Unsafe migration path');
  }
}

/** Offline only: caller must own the data-directory lock and have a verified
 * backup. One page commits at a time; legacy files are retained for recovery. */
export function createLegacyMigration({db,dataDir,assertOffline,onStage=()=>{}}={}) {
  if(!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1 || !path.isAbsolute(dataDir || '') || typeof assertOffline!=='function' || typeof onStage!=='function') throw new TypeError('Invalid migration configuration');
  const root=path.resolve(dataDir), storage=path.join(root,'workspace-storage'),sites=path.join(storage,'sites');
  const guard=()=>{if(assertOffline()!==true)throw new Error('Offline exclusive access required');verifyAncestors(root);};
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}};
  function recover() {
    guard();
    for(const row of db.prepare('SELECT * FROM legacy_migration_journal ORDER BY legacy_id').all()) {
      if(!legacyId.test(row.legacy_id) || !workspacePageId.test(row.target_id) || row.storage_root!==storage) throw new Error('Invalid migration journal');
      if(db.prepare('SELECT 1 FROM workspace_page_ids WHERE id=?').get(row.target_id) || db.prepare('SELECT 1 FROM workspace_pages WHERE id=? OR storage_id=?').get(row.target_id,row.target_id) || db.prepare('SELECT 1 FROM legacy_migration_map WHERE target_id=?').get(row.target_id)) throw new Error('Migration target is referenced');
      verifyAncestors(sites);const target=path.join(sites,row.target_id);
      let exists=true;try{fs.lstatSync(target);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
      if(exists){safeTree(target);fs.rmSync(target,{recursive:true});}
      db.prepare('DELETE FROM legacy_migration_journal WHERE legacy_id=? AND target_id=?').run(row.legacy_id,row.target_id);
    }
  }
  function migrate({accountId,pageId}={}) {
    guard();if(typeof accountId!=='string'||!accountId||!legacyId.test(pageId||''))throw new Error('Invalid migration selection');
    const workspaceId=personalWorkspace(db,accountId);
    const previous=db.prepare('SELECT * FROM legacy_migration_map WHERE legacy_id=?').get(pageId);
    if(previous){
      if(previous.account_id!==accountId || previous.workspace_id!==workspaceId)throw new Error('Account or workspace does not match migration');
      if(!db.prepare('SELECT 1 FROM workspace_pages WHERE id=? AND workspace_id=? AND storage_id=?').get(previous.target_id,workspaceId,previous.target_id))throw new Error('Migrated target is missing');
      const accessMode=db.prepare('SELECT 1 FROM workspace_page_visibility WHERE page_id=?').get(previous.target_id) ? 'public' : 'private';
      return {pageId:previous.target_id,workspaceId,accessMode};
    }
    if(db.prepare('SELECT 1 FROM legacy_migration_journal LIMIT 1').get())throw new Error('Migration recovery required');
    const plan=inspectLegacyMigration({db,dataDir:root,accountId,pageIds:[pageId]}).pages[0];
    ensureSafeDirectory(storage);ensureSafeDirectory(sites);verifyAncestors(sites);
    const targetId=`w-${randomBytes(16).toString('hex')}`, target=path.join(sites,targetId);
    if(db.prepare('SELECT 1 FROM workspace_page_ids WHERE id=?').get(targetId))throw new Error('Migration identifier collision');
    fs.mkdirSync(target);
    try {tx(()=>db.prepare('INSERT INTO legacy_migration_journal VALUES (?,?,?)').run(pageId,targetId,storage));}
    catch(error){fs.rmdirSync(target);throw error;}
    try {
      onStage('journaled');fs.mkdirSync(path.join(target,'releases'));
      for(const release of plan.releases){const dest=path.join(target,'releases',release.releaseId);copyTree(release.sourceDir,dest);const actual=inspectRelease(dest,release.entryFile);if(actual.bytes!==release.sizeBytes||actual.files!==release.fileCount||actual.digest!==release.digest)throw new Error('Copied release differs from source');}
      onStage('copied');
      const result=tx(()=>{
        guard();const latest=inspectLegacyMigration({db,dataDir:root,accountId,pageIds:[pageId]}).pages[0];
        if(JSON.stringify(latest)!==JSON.stringify(plan))throw new Error('Legacy page changed during migration');
        const current=plan.releases.find(r=>r.releaseId===plan.currentReleaseId),at=new Date().toISOString();
        db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(targetId);
        db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(targetId,workspaceId,accountId,plan.title,'private',targetId,current.releaseId,current.entryFile,current.sourceType,current.originalFilename,current.sizeBytes,current.fileCount,plan.createdAt,at);
        db.prepare('INSERT INTO workspace_page_revisions VALUES (?,0)').run(targetId);
        for(const release of plan.releases)db.prepare('INSERT INTO workspace_page_releases VALUES (?,?,?,?,?,?,?,?)').run(targetId,release.releaseId,release.entryFile,release.sourceType,release.originalFilename,release.sizeBytes,release.fileCount,release.createdAt);
        if(plan.accessMode==='public')db.prepare('INSERT INTO workspace_page_visibility VALUES (?)').run(targetId);
        db.prepare('INSERT INTO legacy_migration_map VALUES (?,?,?,?,?)').run(pageId,targetId,workspaceId,accountId,plan.accessMode);
        db.prepare('DELETE FROM pages WHERE id=?').run(pageId);
        db.prepare('INSERT INTO platform_admin_audit VALUES (?,?,?,?,?)').run(randomUUID(),'system:legacy-migration','legacy.migrate',targetId,Date.now());
        db.prepare('DELETE FROM legacy_migration_journal WHERE legacy_id=? AND target_id=?').run(pageId,targetId);
        return {pageId:targetId,workspaceId,accessMode:plan.accessMode};
      });
      onStage('committed');return result;
    } catch(error) { try{recover();}catch(recovery){throw new AggregateError([error,recovery],'Migration failed; recovery required');}throw error; }
  }
  return {migrate,recover};
}
