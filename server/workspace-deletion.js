import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Install separately after workspace pages. No paths from a request are stored.
export const deletionJournalSql = `
CREATE TABLE workspace_deletion_journal (
 page_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision INTEGER NOT NULL,
 storage_root TEXT NOT NULL, quarantine_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
`;
const pagePattern=/^w-[a-f0-9]{32}$/;
const quarantinePattern=/^[a-f0-9]{32}$/;
const fail=message=>{throw new Error(message);};
function safeDirectoryTree(root) {
 const stat=fs.lstatSync(root);
 if(stat.isSymbolicLink() || !stat.isDirectory()) fail('Unsafe directory');
 for(const entry of fs.readdirSync(root)) {
  const child=path.join(root,entry), s=fs.lstatSync(child);
  if(s.isSymbolicLink()) fail('Unsafe symbolic link');
  if(s.isDirectory()) safeDirectoryTree(child);
  else if(!s.isFile()) fail('Unsafe file type');
 }
}
function exists(p){try{return fs.lstatSync(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function verifyAncestors(dir){
 for(let p=dir;;p=path.dirname(p)){
  const stat=fs.lstatSync(p);if(stat.isSymbolicLink()||!stat.isDirectory())fail('Unsafe storage ancestor');
  if(path.dirname(p)===p)break;
 }
}
/** Requires one process, exclusive storage and a host-enforced maintenance window. */
export function createWorkspaceDeletionService({db,storageRoot,assertQuiescent,onStage=()=>{},onDelete=()=>{}}={}){
 if(!db||db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1||!path.isAbsolute(storageRoot||'')||typeof assertQuiescent!=='function'||typeof onStage!=='function'||typeof onDelete!=='function') throw new TypeError('Invalid deletion configuration');
 const root=path.resolve(storageRoot),sites=path.join(root,'sites');
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}};
 const guard=()=>{if(assertQuiescent()!==true)fail('Maintenance window required');verifyAncestors(sites);};
 const paths=row=>{
  if(!pagePattern.test(row.page_id)||!quarantinePattern.test(row.quarantine_id)||row.storage_root!==root)fail('Invalid journal identifiers');
  return {source:path.join(sites,row.page_id),quarantine:path.join(sites,`.retention-${row.quarantine_id}`)};
 };
 const recoverOne=row=>{
  guard();const p=paths(row),page=db.prepare('SELECT id,workspace_id,storage_id FROM workspace_pages WHERE id=?').get(row.page_id);
  const src=exists(p.source),isolated=exists(p.quarantine);
  if(src) safeDirectoryTree(p.source);
  if(isolated) safeDirectoryTree(p.quarantine);
  if(page){
   if(page.workspace_id!==row.workspace_id||page.storage_id!==row.page_id||src&&isolated||!src&&!isolated)fail('Conflicting recovery state');
   if(isolated)fs.renameSync(p.quarantine,p.source);
  }else{
   if(src)fail('Untracked page directory');
   if(db.prepare('SELECT 1 FROM workspace_pages WHERE storage_id=?').get(row.page_id))fail('Storage still referenced');
   if(isolated)fs.rmSync(p.quarantine,{recursive:true});
  }
  db.prepare('DELETE FROM workspace_deletion_journal WHERE page_id=? AND quarantine_id=?').run(row.page_id,row.quarantine_id);
 };
 const recover=()=>{guard();for(const row of db.prepare('SELECT * FROM workspace_deletion_journal ORDER BY page_id').all())recoverOne(row);};
 const execute=({pageId,workspaceId,revision,validate,actor}={})=>{
  guard();if(!pagePattern.test(pageId||'')||typeof workspaceId!=='string'||!workspaceId||!Number.isSafeInteger(revision)||revision<0||typeof validate!=='function')throw new TypeError('Invalid deletion request');
  if(db.prepare('SELECT 1 FROM workspace_deletion_journal LIMIT 1').get())fail('Recovery required');
  const page=db.prepare('SELECT p.*,r.revision FROM workspace_pages p JOIN workspace_page_revisions r ON r.page_id=p.id WHERE p.id=?').get(pageId);
  if(!page||page.workspace_id!==workspaceId||page.storage_id!==pageId||page.revision!==revision) return false;
  const quarantineId=randomBytes(16).toString('hex'), row={page_id:pageId,workspace_id:workspaceId,revision,storage_root:root,quarantine_id:quarantineId};
  const p=paths(row);safeDirectoryTree(p.source);if(exists(p.quarantine))fail('Quarantine collision');
  tx(()=>db.prepare('INSERT INTO workspace_deletion_journal VALUES (?,?,?,?,?,?)').run(pageId,workspaceId,revision,root,quarantineId,Date.now()));
  try{
   onStage('journaled');guard();safeDirectoryTree(p.source);if(exists(p.quarantine))fail('Quarantine collision');fs.renameSync(p.source,p.quarantine);onStage('isolated');
   const deleted=tx(()=>{
    const current=db.prepare('SELECT p.workspace_id,p.storage_id,r.revision FROM workspace_pages p JOIN workspace_page_revisions r ON r.page_id=p.id WHERE p.id=?').get(pageId);
    if(!current||current.workspace_id!==workspaceId||current.storage_id!==pageId||current.revision!==revision)return false;
    if(validate({db,pageId,workspaceId,revision})!==true)return false;
    const deleted=db.prepare('DELETE FROM workspace_pages WHERE id=? AND workspace_id=? AND storage_id=?').run(pageId,workspaceId,pageId).changes===1;
    if(deleted){onDelete({db,pageId,workspaceId,actor});onStage('deleted');}
    return deleted;
   });
   if(deleted)onStage('committed');recoverOne(row);return deleted;
  }catch(error){try{recoverOne(row);}catch{}throw error;}
 };
 return {execute,recover,hasPending:()=>Boolean(db.prepare('SELECT 1 FROM workspace_deletion_journal LIMIT 1').get())};
}
