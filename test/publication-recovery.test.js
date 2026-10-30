import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { publicationJournalSql, createPublicationRecovery } from '../server/publication-recovery.js';

const staging='w-11111111111111111111111111111111', page='w-22222222222222222222222222222222', release='123-aaaaaaaaaa';
function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-publication-'));
  const sites=path.join(root,'sites');fs.mkdirSync(sites);
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE workspace_pages(id TEXT PRIMARY KEY,storage_id TEXT,release_id TEXT); CREATE TABLE workspace_page_releases(page_id TEXT,release_id TEXT);');db.exec(publicationJournalSql);
  t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
  const journal=(s,p,r)=>db.prepare('INSERT INTO workspace_publication_journal VALUES (?,?,?,?)').run(s,p,r,root);
  const dir=(...parts)=>{const d=path.join(sites,...parts);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'index.html'),'content');return d;};
  return {root,db,journal,dir,recover:()=>createPublicationRecovery({db,storageRoot:root,assertQuiescent:()=>true}).recover()};
}
test('recovery removes only a recorded uncommitted publication and preserves committed releases',t=>{
 const x=setup(t);x.db.prepare('INSERT INTO workspace_pages VALUES (?,?,?)').run(page,page,'old');x.journal(staging,page,release);
 const tmp=x.dir(staging,'releases','123-bbbbbbbbbb'),dest=x.dir(page,'releases',release);
 x.recover();assert.equal(fs.existsSync(tmp),false);assert.equal(fs.existsSync(dest),false);
 x.journal(staging,page,release);const tmp2=x.dir(staging,'releases','123-bbbbbbbbbb'),dest2=x.dir(page,'releases',release);
 x.db.prepare('INSERT INTO workspace_page_releases VALUES (?,?)').run(page,release);x.recover();
 assert.equal(fs.existsSync(tmp2),false);assert.equal(fs.readFileSync(path.join(dest2,'index.html'),'utf8'),'content');assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_publication_journal').get().n,0);
});
test('recovery preserves a committed new page and removes only recorded abandoned pages',t=>{
 const x=setup(t);x.journal(staging,staging,null);const tmp=x.dir(staging,'releases',release);x.recover();assert.equal(fs.existsSync(tmp),false);
 x.journal(staging,staging,null);const live=x.dir(staging,'releases',release);x.db.prepare('INSERT INTO workspace_pages VALUES (?,?,?)').run(staging,staging,release);x.recover();assert.equal(fs.existsSync(live),true);
});
test('recovery refuses incorrect roots and never touches unrecorded directories',t=>{
 const x=setup(t);const unrelated=x.dir(page,'releases',release);x.journal(staging,staging,null);
 x.db.prepare('UPDATE workspace_publication_journal SET storage_root=?').run(path.join(x.root,'elsewhere'));
 assert.throws(x.recover,/root|record/i);assert.equal(fs.existsSync(unrelated),true);
});
test('recovery refuses missing files for a committed publication',t=>{
 const x=setup(t);x.db.prepare('INSERT INTO workspace_pages VALUES (?,?,?)').run(page,page,release);
 x.db.prepare('INSERT INTO workspace_page_releases VALUES (?,?)').run(page,release);x.journal(staging,page,release);
 assert.throws(x.recover,/missing/i);assert.equal(x.db.prepare('SELECT count(*) n FROM workspace_publication_journal').get().n,1);
});
