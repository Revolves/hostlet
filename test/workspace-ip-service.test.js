import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { workspaceSchema } from '../server/workspaces.js';
import { workspacePagesSchema } from '../server/workspace-pages.js';
import { workspaceHostingSchema, createWorkspaceIpHostingService } from '../server/workspace-hosting.js';

test('IP hosting uses existing one-time membership tickets without relaxing domain hosting', t => {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY);');db.exec(workspaceSchema);db.exec(workspacePagesSchema);db.exec(workspaceHostingSchema);
  db.exec("INSERT INTO users VALUES ('alice'); INSERT INTO workspaces VALUES ('team','Team','team','alice','now'); INSERT INTO workspace_members VALUES ('team','alice','owner','now');");
  const id='w-'+'a'.repeat(32);db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(id);
  db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'team','alice','Title','private',id,'1-aaaaaaaaaa','index.html','zip','x.zip',1,1,'now','now');
  const options={db,storageRoot:path.resolve(os.tmpdir()),managementOrigin:'https://192.0.2.1:30006',contentOrigin:'https://192.0.2.1:30007'};
  const service=createWorkspaceIpHostingService(options);
  const ticket=service.issue(id,'alice');const session=service.exchange(id,ticket);
  assert.ok(service.authorize(id,session.value));assert.equal(service.exchange(id,ticket),null);
  db.prepare("DELETE FROM workspace_members WHERE workspace_id='team' AND user_id='alice'").run();
  assert.equal(service.authorize(id,session.value),null);
  for (const contentOrigin of ['https://192.0.2.2:30007','https://192.0.2.1:30006','http://192.0.2.1:30007','https://apps.example.test:30007']) assert.throws(()=>createWorkspaceIpHostingService({...options,contentOrigin}),/origin/i);
});
