import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// This cooperative lock is deliberately never reclaimed automatically. The
// data directory must be private to trusted operators on a local filesystem.
// After a crash an operator must first verify all processes are stopped.
export function acquireInstanceLock(dataDir) {
  if (!path.isAbsolute(dataDir || '')) throw new TypeError('An absolute data directory is required');
  fs.mkdirSync(dataDir,{recursive:true});
  const root=fs.realpathSync(dataDir), lockDir=path.join(root,'.hostlet-instance-lock'), marker=path.join(lockDir,'owner.json');
  try { fs.mkdirSync(lockDir); }
  catch (error) { if (error.code==='EEXIST') throw new Error('Data directory is already in use or requires offline lock recovery'); throw error; }
  const token=randomBytes(32).toString('hex');
  const record=JSON.stringify({pid:process.pid,createdAt:new Date().toISOString(),token});
  try { fs.writeFileSync(marker,record,{flag:'wx',mode:0o600}); }
  catch (error) { try { fs.rmdirSync(lockDir); } catch {} throw error; }
  let released=false;
  return {
    release() {
      if (released) return;
      const stat=fs.lstatSync(lockDir);
      if (stat.isSymbolicLink() || !stat.isDirectory() || fs.readFileSync(marker,'utf8')!==record) throw new Error('Instance lock ownership changed');
      fs.unlinkSync(marker); fs.rmdirSync(lockDir); released=true;
    }
  };
}
