import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { platformAdminSchema, createPlatformAdminService } from '../server/platform-admin.js';
import { createPlatformAdminRouter } from '../server/platform-admin-router.js';
import { workspacePagesSchema } from '../server/workspace-pages.js';
import express from 'express';
import http from 'node:http';
import { Duplex } from 'node:stream';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE workspace_page_ids(id TEXT PRIMARY KEY); CREATE TABLE workspace_pages(id TEXT PRIMARY KEY REFERENCES workspace_page_ids(id)); INSERT INTO workspace_page_ids VALUES ('p1'); INSERT INTO workspace_pages VALUES ('p1');");
  db.exec(platformAdminSchema);
  t.after(() => db.close());
  return {db, service:createPlatformAdminService({db, now:()=>1000})};
}
const valid = {registrationEnabled:true, retention:{mode:'inactivity',days:30,notifyBeforeDays:7}, defaultQuotas:{maxApps:2,maxStorageBytes:100,maxUploadBytes:50}};
const code = (fn, expected) => assert.throws(fn, e => e.code === expected);

test('report pagination reaches older records despite new submissions and equal timestamps', t => {
  const {service}=setup(t);
  const ids=Array.from({length:105},()=>service.submitReport({pageId:'p1',category:'spam',description:'report'}).id);
  const first=service.listReportPage();
  assert.equal(first.reports.length,50);assert.ok(first.nextCursor);
  const added=service.submitReport({pageId:'p1',category:'spam',description:'new'}).id;
  const second=service.listReportPage(first.nextCursor);
  const third=service.listReportPage(second.nextCursor);
  const seen=[...first.reports,...second.reports,...third.reports].map(row=>row.id);
  for(const id of ids) assert.ok(seen.includes(id));
  assert.equal(new Set(seen).size,seen.length);assert.equal(third.nextCursor,null);
  assert.ok(seen.length===105 || (seen.length===106 && seen.includes(added)));
  code(()=>service.listReportPage({createdAt:-1,id:'x'}),'INVALID');
});

test('settings reject invalid or inconsistent values and roll back audit', t => {
  const {db,service}=setup(t);
  assert.equal(service.getSettings().registrationEnabled,false);
  for (const value of [ {...valid,registrationEnabled:'yes'}, {...valid,retention:{mode:'inactivity',days:7,notifyBeforeDays:7}}, {...valid,retention:{mode:'inactivity',days:30,notifyBeforeDays:0}}, {...valid,retention:{mode:'long-term',days:30,notifyBeforeDays:1}}, {...valid,defaultQuotas:{maxApps:1,maxStorageBytes:3,maxUploadBytes:4}}, {...valid,defaultQuotas:{...valid.defaultQuotas,maxApps:-1}}, {...valid, actor:'spoof'} ]) code(()=>service.updateSettings('admin',value),'INVALID');
  assert.equal(db.prepare('SELECT count(*) n FROM platform_admin_audit').get().n,0);
  assert.deepEqual(service.updateSettings('admin',valid),valid);
  assert.deepEqual(service.getSettings(),valid);
  assert.equal(db.prepare('SELECT actor_id FROM platform_admin_audit').get().actor_id,'admin');
});

test('reports, decisions and suspension retain data and audit atomically', t => {
  const {db,service}=setup(t);
  code(()=>service.submitReport({pageId:'missing',category:'abuse',description:'bad'}),'NOT_FOUND');
  code(()=>service.submitReport({pageId:'p1',category:'',description:'bad'}),'INVALID');
  code(()=>service.submitReport({pageId:'p1',category:'abuse',description:'x'.repeat(2001)}),'INVALID');
  const report=service.submitReport({pageId:'p1',category:'abuse',description:'issue'});
  assert.equal(service.listReports()[0].status,'pending');
  service.resolveReport('admin',report.id);
  assert.equal(service.listReports()[0].status,'resolved');
  service.suspendPage('admin','p1'); assert.equal(service.isSuspended('p1'),true);
  service.restorePage('admin','p1'); assert.equal(service.isSuspended('p1'),false);
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_pages').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM platform_reports').get().n,1);
  assert.deepEqual(db.prepare('SELECT action FROM platform_admin_audit ORDER BY rowid').all().map(r=>r.action),['report.resolve','page.suspend','page.restore']);
  db.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON platform_admin_audit BEGIN SELECT RAISE(ABORT,'denied'); END;");
  assert.throws(()=>service.suspendPage('admin','p1'));
  assert.equal(service.isSuspended('p1'),false);
});

test('report list reflects the current page state even after suspension or deletion', t=>{
  const {db,service}=setup(t);const report=service.submitReport({pageId:'p1',category:'abuse',description:'review'});
  const state=()=>service.listReportPage().reports.find(item=>item.id===report.id).pageState;
  assert.equal(state(),'active');service.suspendPage('admin','p1');assert.equal(state(),'suspended');
  service.restorePage('admin','p1');assert.equal(state(),'active');
  db.prepare('DELETE FROM workspace_pages WHERE id=?').run('p1');assert.equal(state(),'deleted');
  service.resolveReport('admin',report.id);assert.equal(service.listReportPage().reports[0].status,'resolved');
});

test('reported and suspended pages can be deleted without reusing their reserved IDs', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE workspaces(id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('u'); INSERT INTO workspaces VALUES ('w');`);
  db.exec(workspacePagesSchema);
  db.exec(platformAdminSchema);
  const createPage = id => {
    db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(id);
    db.prepare(`INSERT INTO workspace_pages VALUES (?,?,?,'title','private',?, 'release',
      'index.html','html','index.html',1,1,'now','now')`).run(id,'w','u',id);
  };
  createPage('reported'); createPage('suspended');
  const service = createPlatformAdminService({db,now:()=>1000});
  const report = service.submitReport({pageId:'reported',category:'spam',description:'history'});
  service.suspendPage('admin','suspended');
  db.prepare('DELETE FROM workspace_pages WHERE id=?').run('reported');
  db.prepare('DELETE FROM workspace_pages WHERE id=?').run('suspended');
  assert.equal(service.listReports()[0].id,report.id);
  assert.equal(service.listReports()[0].description,'history');
  assert.equal(service.isSuspended('suspended'),true);
  for (const id of ['reported','suspended']) {
    assert.throws(()=>db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(id), /UNIQUE/);
    code(()=>service.submitReport({pageId:id,category:'spam',description:'x'}),'NOT_FOUND');
    code(()=>service.suspendPage('admin',id),'NOT_FOUND');
  }
  assert.equal(db.prepare('SELECT count(*) n FROM workspace_page_ids').get().n,2);
});

test('router requires admin, exact origin, and limits all writes including malformed bodies', async t => {
  const {service,db}=setup(t);
  const app=express(); app.use('/platform',createPlatformAdminRouter({service,managementOrigin:'https://manage.example',requireAdmin:(req,res,next)=>{if(req.headers.authorization!=='admin') return res.sendStatus(401); req.admin={id:'server-actor'}; next();},rateLimit:{ipLimit:4,globalLimit:100,windowMs:60000}}));
  const server=http.createServer(app);
  const call=(path,{method='GET',body,origin='https://manage.example',auth,ip='127.0.0.1'}={})=>new Promise((resolve,reject)=>{
    const payload=body === undefined ? '' : JSON.stringify(body);
    let response='';
    const socket=new Duplex({read(){},write(chunk,_enc,done){response+=chunk.toString();done();},final(done){
      const [head,...rest]=response.split('\r\n\r\n');
      resolve({status:Number(head.split(' ')[1]),body:rest.join('\r\n\r\n')});done();
    }});
    socket.on('error',reject);socket.remoteAddress=ip;server.emit('connection',socket);
    socket.push(`${method} /platform${path} HTTP/1.1\r\nHost: manage.example\r\nConnection: close\r\n${origin?`Origin: ${origin}\r\n`:''}${auth?`Authorization: ${auth}\r\n`:''}${body!==undefined?`Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n`:''}\r\n${payload}`);
  });
  assert.equal((await call('/settings')).status,401);
  assert.equal((await call('/settings',{method:'PUT',origin:'https://evil.example',auth:'admin',body:valid})).status,403);
  assert.equal((await call('/reports',{method:'POST',body:{pageId:'p1',category:'spam',description:'x'}})).status,201);
  assert.equal((await call('/settings',{method:'PUT',auth:'admin',body:{...valid,actor:'attacker'}})).status,400);
  assert.equal((await call('/settings',{method:'PUT',auth:'admin',body:valid})).status,200);
  assert.equal(db.prepare('SELECT actor_id FROM platform_admin_audit').get().actor_id,'server-actor');
  assert.equal((await call('/pages/p1/suspend',{method:'POST',auth:'admin',body:{}})).status,204);
  assert.equal((await call('/pages/p1/restore',{method:'POST',auth:'admin',body:{}})).status,429);
});


test('admin routes resolve reports, suspend and restore with server actor', async t => {
  const {service,db}=setup(t);
  const app=express();
  app.use(createPlatformAdminRouter({service,managementOrigin:'https://manage.example',requireAdmin:(req,res,next)=>{if(req.headers.authorization!=='admin') return res.sendStatus(403);req.admin={id:'trusted-admin'};next();}}));
  const server=http.createServer(app);
  const call=(path,method='GET',body,auth='admin',origin='https://manage.example')=>new Promise((resolve,reject)=>{
    const payload=body===undefined?'':JSON.stringify(body);let data='';
    const socket=new Duplex({read(){},write(chunk,_e,cb){data+=chunk;cb();},final(cb){const [head,...rest]=data.split('\r\n\r\n');resolve({status:Number(head.split(' ')[1]),body:rest.join('\r\n\r\n')});cb();}});
    socket.on('error',reject);socket.remoteAddress='127.0.0.2';server.emit('connection',socket);
    socket.push(`${method} ${path} HTTP/1.1\r\nHost: manage.example\r\nConnection: close\r\n${origin?`Origin: ${origin}\r\n`:''}${auth?`Authorization: ${auth}\r\n`:''}${body!==undefined?`Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n`:''}\r\n${payload}`);
  });
  assert.equal((await call('/reports','GET',undefined,'no')).status,403);
  assert.equal((await call('/reports/before/1000/any','GET',undefined,'no')).status,403);
  assert.equal((await call('/reports/before/not-a-time/any')).status,400);
  assert.equal((await call('/reports','POST',{pageId:'p1',category:'spam',description:'private report'},'', '')).status,403);
  assert.equal((await call('/reports','POST',{pageId:'missing',category:'spam',description:'x'},'')).status,404);
  const created=await call('/reports','POST',{pageId:'p1',category:'spam',description:'private report'},'');
  const id=JSON.parse(created.body).id;
  assert.equal(created.status,201);
  assert.equal((await call(`/reports/${id}/resolve`,'POST',{})).status,204);
  assert.equal((await call(`/reports/${id}/resolve`,'POST',{})).status,409);
  assert.equal((await call('/pages/p1/suspend','POST',{})).status,204);
  assert.equal(service.isSuspended('p1'),true);
  assert.equal((await call('/pages/p1/restore','POST',{})).status,204);
  assert.equal(service.isSuspended('p1'),false);
  const list=JSON.parse((await call('/reports')).body).reports;
  assert.equal(list[0].status,'resolved');
  assert.deepEqual(db.prepare('SELECT actor_id FROM platform_admin_audit').all().map(r=>r.actor_id),['trusted-admin','trusted-admin','trusted-admin']);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM platform_admin_audit').all()).includes('private report'));
});
