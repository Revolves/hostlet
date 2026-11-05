import fs from 'node:fs';
import path from 'node:path';

export const uploadTempJournalSql = `
CREATE TABLE workspace_upload_temp_journal (id TEXT PRIMARY KEY, storage_root TEXT NOT NULL);
`;
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function checkDirectory(dir) {
  for(let current=dir;;current=path.dirname(current)) {
    const stat=fs.lstatSync(current);
    if(stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe temporary storage ancestor');
    if(path.dirname(current)===current) break;
  }
}
export function createUploadTempJournal({db,storageRoot,assertQuiescent}={}) {
  if(!db || !path.isAbsolute(storageRoot||'') || typeof assertQuiescent!=='function') throw new TypeError('Invalid temporary upload configuration');
  const root=path.resolve(storageRoot),dir=path.join(root,'tmp');
  const filename=id=>{if(!idPattern.test(id||''))throw new Error('Invalid temporary upload identifier');return path.join(dir,`upload-${id}`);};
  function remove(id) {
    const file=filename(id),row=db.prepare('SELECT storage_root FROM workspace_upload_temp_journal WHERE id=?').get(id);
    if(!row || row.storage_root!==root) throw new Error('Invalid temporary upload record or root');
    checkDirectory(dir);
    let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(stat) {if(stat.isSymbolicLink() || !stat.isFile())throw new Error('Unsafe temporary upload file');fs.unlinkSync(file);}
    db.prepare('DELETE FROM workspace_upload_temp_journal WHERE id=?').run(id);
  }
  return {
    hasResidual(id) {
      const file=filename(id);
      if (db.prepare('SELECT 1 FROM workspace_upload_temp_journal WHERE id=?').get(id)) return true;
      try { fs.lstatSync(file); return true; }
      catch (error) { if (error.code==='ENOENT') return false; throw error; }
    },
    open(id) {
      const file=filename(id);checkDirectory(dir);
      const fd=fs.openSync(file,'wx',0o600);
      try {db.prepare('INSERT INTO workspace_upload_temp_journal VALUES (?,?)').run(id,root);}
      catch(error){fs.closeSync(fd);try{fs.unlinkSync(file);}catch{}throw error;}
      return {id,path:file,fd};
    },
    remove,
    recover() {
      if(assertQuiescent()!==true) throw new Error('Maintenance window required');
      for(const row of db.prepare('SELECT id FROM workspace_upload_temp_journal ORDER BY id').all()) remove(row.id);
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('upload-') && idPattern.test(name.slice(7))) throw new Error('Unrecorded temporary upload requires manual recovery');
      }
    }
  };
}
