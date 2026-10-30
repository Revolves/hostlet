import fs from 'node:fs';
import path from 'node:path';

// The record is created after an exclusive staging-directory mkdir and before
// writing any content. The destination is recorded before moving a release.
export const publicationJournalSql = `
CREATE TABLE workspace_publication_journal (
 staging_id TEXT PRIMARY KEY, page_id TEXT NOT NULL, release_id TEXT,
 storage_root TEXT NOT NULL
);
`;
const pagePattern=/^w-[a-f0-9]{32}$/;
const releasePattern=/^[0-9]+-[a-f0-9]{10}$/;
function checkedDirectory(dir) {
  let current=path.parse(dir).root;
  for (const part of path.relative(current,dir).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    let stat;try { stat=fs.lstatSync(current); } catch(e) { if(e.code==='ENOENT') return false; throw e; }
    if(stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe publication directory');
  }
  return true;
}
function checkTree(dir) {
  for (const name of fs.readdirSync(dir)) {
    const child=path.join(dir,name), stat=fs.lstatSync(child);
    if(stat.isSymbolicLink()) throw new Error('Unsafe publication entry');
    if(stat.isDirectory()) checkTree(child);
    else if(!stat.isFile()) throw new Error('Unsafe publication entry');
  }
}

// Recovery must run while all writers and hosted readers are stopped.
export function createPublicationRecovery({db,storageRoot,assertQuiescent}) {
  if(!db || db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1 || !path.isAbsolute(storageRoot || '') || typeof assertQuiescent!=='function') throw new TypeError('Invalid publication recovery configuration');
  const root=path.resolve(storageRoot),sites=path.join(root,'sites');
  function recoverOne(row) {
    if(assertQuiescent()!==true) throw new Error('Maintenance window required');
    if(row.storage_root!==root || !pagePattern.test(row.staging_id || '') || !pagePattern.test(row.page_id || '') || (row.release_id!==null && !releasePattern.test(row.release_id))) throw new Error('Invalid publication record or storage root');
    if(row.staging_id===row.page_id && row.release_id!==null) throw new Error('Invalid publication record');
    const staging=path.join(sites,row.staging_id);
    const page=db.prepare('SELECT id,storage_id,release_id FROM workspace_pages WHERE id=?').get(row.page_id);
    const stagingOwner=db.prepare('SELECT id FROM workspace_pages WHERE storage_id=?').get(row.staging_id);
    const targetOwner=db.prepare('SELECT id FROM workspace_pages WHERE storage_id=?').get(row.page_id);
    if(page && page.storage_id!==row.page_id || targetOwner && targetOwner.id!==row.page_id || stagingOwner && stagingOwner.id!==row.page_id) throw new Error('Conflicting publication storage');
    const keepStaging=row.staging_id===row.page_id && !!page;
    if(row.staging_id!==row.page_id && stagingOwner) throw new Error('Staging directory is referenced');
    const dest=row.release_id===null ? null : path.join(sites,row.page_id,'releases',row.release_id);
    const keepDest=dest && (!!db.prepare('SELECT 1 FROM workspace_page_releases WHERE page_id=? AND release_id=?').get(row.page_id,row.release_id) || page?.release_id===row.release_id);
    const stagingExists=checkedDirectory(staging), destExists=dest ? checkedDirectory(dest) : false;
    if(keepStaging && !stagingExists || keepDest && !destExists) throw new Error('Committed publication files are missing');
    if(stagingExists && !keepStaging) checkTree(staging);
    if(destExists && !keepDest) checkTree(dest);
    if(stagingExists && !keepStaging) fs.rmSync(staging,{recursive:true});
    if(destExists && !keepDest) fs.rmSync(dest,{recursive:true});
    db.prepare('DELETE FROM workspace_publication_journal WHERE staging_id=?').run(row.staging_id);
  }
  return {recover(){ if(assertQuiescent()!==true) throw new Error('Maintenance window required'); for(const row of db.prepare('SELECT * FROM workspace_publication_journal ORDER BY staging_id').all()) recoverOne(row); }};
}
