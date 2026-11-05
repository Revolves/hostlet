import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { workspaceSchema, createWorkspaceService } from '../server/workspaces.js';
import { workspacePagesSchema, workspacePageReleasesMigrationSql } from '../server/workspace-pages.js';
import { workspaceVisibilitySchema, publicationReviewSchema, createWorkspaceVisibilityService } from '../server/workspace-visibility.js';

test('visibility defaults private and changes require current workspace editor authorization', t => {
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY)');
  db.exec(workspaceSchema); db.exec(workspacePagesSchema); db.exec(workspacePageReleasesMigrationSql); db.exec(workspaceVisibilitySchema); db.exec(publicationReviewSchema);
  db.exec("INSERT INTO users VALUES ('alice'),('bob'),('eve'); INSERT INTO workspaces VALUES ('one','One','team','alice','now'),('two','Two','team','eve','now'); INSERT INTO workspace_members VALUES ('one','alice','owner','now'),('one','bob','editor','now'),('two','eve','owner','now')");
  const id='w-'+'a'.repeat(32), other='w-'+'b'.repeat(32);
  for (const page of [id,other]) {
    db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(page);
    db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(page,'one','alice','title','private',page,'1-aaaaaaaaaa','index.html','html','x.html',1,1,'now','now');
  }
  const service=createWorkspaceVisibilityService({db,authorize:createWorkspaceService(db).authorize});
  assert.equal(service.get('one','alice',id).visibility,'private');
  assert.equal(service.publicPage(id),null);
  assert.throws(()=>service.set('one','bob',id,'public'),e=>e.code==='FORBIDDEN');
  assert.equal(service.set('one','alice',id,'public').visibility,'public');
  assert.notEqual(db.prepare('SELECT updated_at FROM workspace_pages WHERE id=?').get(id).updated_at,'now');
  assert.equal(service.publicPage(id).id,id);
  assert.equal(service.get('one','alice',other).visibility,'private');
  assert.throws(()=>service.set('two','eve',id,'public'),e=>e.code==='NOT_FOUND');
  db.exec("UPDATE workspace_members SET role='viewer' WHERE user_id='bob'");
  assert.throws(()=>service.set('one','bob',id,'private'),e=>e.code==='FORBIDDEN');
  assert.equal(service.set('one','alice',id,'private').visibility,'private');
  assert.equal(service.publicPage(id),null);
  assert.throws(()=>service.set('one','alice',id,'invalid'),e=>e.code==='INVALID');
  db.prepare('DELETE FROM workspace_pages WHERE id=?').run(id);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_page_visibility').get().n,0);
});
