import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { workspaceSchema } from '../server/workspaces.js';
import { workspacePagesSchema } from '../server/workspace-pages.js';
import { workspaceHostingSchema, createWorkspaceHostingService, createWorkspaceHostingManagementRouter, createWorkspaceHostingAppRouter } from '../server/workspace-hosting.js';
import { workspaceShareSchema, createWorkspaceShareService } from '../server/workspace-shares.js';
import { createWorkspaceShareRouter } from '../server/workspace-share-router.js';
import { createMaintenanceGate } from '../server/maintenance.js';

test('application domain reserves space for the page label and validates port range', t => {
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close()); db.exec('PRAGMA foreign_keys=ON');
  const config={db,storageRoot:path.resolve(os.tmpdir()),managementOrigin:'https://manage.hostlet.test'};
  const dns218=['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(21),'test'].join('.');
  assert.equal(dns218.length,218);
  for (const domain of [dns218,`${dns218}:1`,`${dns218}:65535`]) assert.doesNotThrow(()=>createWorkspaceHostingService({...config,appDomain:domain}));
  for (const domain of [`${dns218.replace('d'.repeat(21),'d'.repeat(22))}`, 'apps.example.test:0','apps.example.test:65536','apps.example.test:99999']) assert.throws(()=>createWorkspaceHostingService({...config,appDomain:domain}),/domain/i);
});

test('HTTPS default port is canonicalized for app host lookup and downstream consumers', t => {
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close());
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE workspace_pages(id TEXT PRIMARY KEY,access_mode TEXT); INSERT INTO workspace_pages VALUES ('w-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','private')");
  const options={db,storageRoot:path.resolve(os.tmpdir()),managementOrigin:'https://manage.hostlet.test'};
  const id='w-'+'a'.repeat(32);
  for (const domain of ['apps.example.test:443','apps.example.test:00443']) {
    const service=createWorkspaceHostingService({...options,appDomain:domain});
    assert.equal(service.appDomain,'apps.example.test');
    assert.equal(service.hostPage(`${id}.apps.example.test`),id);
    assert.equal(service.hostPage(`${id}.apps.example.test:443`),null);
  }
  const custom=createWorkspaceHostingService({...options,appDomain:'apps.example.test:8443'});
  assert.equal(custom.appDomain,'apps.example.test:8443');
  assert.equal(custom.hostPage(`${id}.apps.example.test:8443`),id);
  assert.equal(custom.hostPage(`${id}.apps.example.test`),null);
});

test('private hosting authenticates every request and confines app credentials and files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hostlet-hosting-'));
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY);');
  db.exec(workspaceSchema); db.exec(workspacePagesSchema); db.exec(workspaceHostingSchema); db.exec(workspaceShareSchema);
  db.exec("INSERT INTO users VALUES ('alice'),('bob'),('outsider'); INSERT INTO workspaces VALUES ('team','Team','team','alice','now'); INSERT INTO workspace_members VALUES ('team','alice','owner','now'),('team','bob','viewer','now');");
  const a = 'w-' + 'a'.repeat(32), b = 'w-' + 'b'.repeat(32);
  for (const id of [a,b]) {
    db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(id);
    db.prepare("INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,'team','alice','Title','private',id,'1-aaaaaaaaaa','index.html','zip','x.zip',10,4,'now','now');
    const dir = path.join(root,'sites',id,'releases','1-aaaaaaaaaa');
    await fs.mkdir(path.join(dir,'nested'), {recursive:true});
    for (const [file, content] of [['index.html','<script src="/nested/app.js"></script>'],['nested/index.html','<script src="app.js"></script>'],['nested/100%.html','percent'],['nested/app.js','ok'],['nested/style.css','body{}'],['nested/image.png','image']]) await fs.writeFile(path.join(dir,file),content);
  }
  let time = 1000000;
  assert.throws(() => createWorkspaceHostingService({db, storageRoot:root, appDomain:'apps.example.test', managementOrigin:'https://admin.example.test'}), /origin/i);
  assert.throws(() => createWorkspaceHostingService({db, storageRoot:root, appDomain:'apps.example.co.uk', managementOrigin:'https://admin.example.co.uk'}), /origin/i);
  assert.throws(() => createWorkspaceHostingService({db, storageRoot:root, appDomain:'apps.example.test:99999', managementOrigin:'https://manage.hostlet.test'}), /domain/i);
  let publicAccess=false, suspended=false;
  const service = createWorkspaceHostingService({db, storageRoot:root, appDomain:'apps.example.test', managementOrigin:'https://manage.hostlet.test', now:()=>time, ticketTtlMs:30000, sessionTtlMs:60000,
    publicPage:id => publicAccess ? db.prepare('SELECT * FROM workspace_pages WHERE id=?').get(id) : null, isSuspended:()=>suspended});
  const shares=createWorkspaceShareService({db,authorize:()=>{},limitAttempt:()=>true,now:()=>time,sessionTtlMs:60000});
  const gate=createMaintenanceGate();
  const app = express();
  app.use('/share',createWorkspaceShareRouter({service:shares,managementOrigin:'https://manage.hostlet.test',requireUser:(req,res,next)=>{req.user={id:'alice'};next();}}));
  app.use('/manage', createWorkspaceHostingManagementRouter({service, requireUser:(req,res,next)=> { if(!['alice','bob','outsider'].includes(req.headers['x-user'])) return res.sendStatus(401); req.user={id:req.headers['x-user']}; next(); }}));
  app.use(gate.middleware,createWorkspaceHostingAppRouter({service,shareService:shares,transferTimeoutMs:300}));
  const server = await new Promise((resolve,reject)=>{ const s=app.listen(0,'127.0.0.1',()=>resolve(s)); s.on('error',reject); });
  t.after(async()=>{ await new Promise(resolve=>server.close(resolve)); db.close(); await fs.rm(root,{recursive:true,force:true}); });
  const request = (host, url, {method='GET',body,headers={}}={}) => new Promise((resolve,reject)=>{ const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers:{host,...headers}},res=>{let data='';res.setEncoding('utf8');res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));}); req.on('error',reject); req.end(body); });
  const issue = async (id=a,user='bob') => { const r=await request('manage.example.test',`/manage/${id}/tickets`,{method:'POST',headers:{'x-user':user}}); assert.equal(r.status,201); return JSON.parse(r.body).ticket; };
  const exchange = (id,ticket) => request(`${id}.apps.example.test`,'/__host/exchange',{method:'POST',headers:{origin:'https://manage.hostlet.test','content-type':'application/x-www-form-urlencoded'},body:`ticket=${ticket}`});
  const share=await shares.create('team','alice',a,{password:'share password'});
  const issued=await request('manage.hostlet.test','/share/ticket',{method:'POST',headers:{origin:'https://manage.hostlet.test','content-type':'application/json'},body:JSON.stringify({pageId:a,token:share.token,password:'share password'})});
  assert.equal(issued.status,201); const shareTicket=JSON.parse(issued.body).ticket;
  assert.equal((await exchange(b,shareTicket)).status,401);
  const shareExchange=await exchange(a,shareTicket); assert.equal(shareExchange.status,303);
  assert.equal((await exchange(a,shareTicket)).status,401);
  const shareSet=shareExchange.headers['set-cookie'][0]; assert.match(shareSet,/^__Host-workspace-share=/); assert.match(shareSet,/HttpOnly/); assert.match(shareSet,/Secure/); assert.doesNotMatch(shareSet,/Domain=/i);
  const shareCookie=shareSet.split(';')[0];
  assert.equal((await request(`${a}.apps.example.test`,'/nested/app.js',{headers:{cookie:shareCookie}})).status,200);
  assert.equal((await request(`${a}.apps.example.test`,'/nested/',{headers:{cookie:shareCookie}})).status,200);
  assert.equal((await request(`${b}.apps.example.test`,'/',{headers:{cookie:shareCookie}})).status,401);
  assert.equal((await request(`${a}.apps.example.test`,'/',{headers:{cookie:`${shareCookie}; ${shareCookie}`}})).status,401);
  shares.revoke('team','alice',a,share.id);
  assert.equal((await request(`${a}.apps.example.test`,'/nested/style.css',{headers:{cookie:shareCookie}})).status,401);
  const expiring=await shares.create('team','alice',a,{expiresAt:time+1000});
  const expiringSession=await exchange(a,await shares.issue(a,expiring.token,undefined,'client'));
  const expiringCookie=expiringSession.headers['set-cookie'][0].split(';')[0]; time+=1000;
  assert.equal((await request(`${a}.apps.example.test`,'/nested/app.js',{headers:{cookie:expiringCookie}})).status,401);
  assert.equal((await request('manage.example.test',`/manage/${a}/tickets`,{method:'POST',headers:{'x-user':'mallory'}})).status,401);
  assert.equal((await request('manage.example.test',`/manage/${a}/tickets`,{method:'POST',headers:{'x-user':'outsider','content-type':'application/json'},body:'{"user":"alice"}'})).status,404);
  assert.equal((await request(`${a}.apps.example.test`,'/')).status,401);
  assert.equal((await request(`${a}.apps.example.test`,'/nested')).status,401);
  publicAccess=true;
  assert.equal((await request(`${a}.apps.example.test`,'/nested/app.js')).status,200);
  suspended=true;
  assert.notEqual((await request(`${a}.apps.example.test`,'/nested/app.js')).status,200);
  suspended=false; publicAccess=false;
  assert.equal((await request(`${a}.apps.example.test`,'/nested/app.js')).status,401);
  for (const host of ['apps.example.test',`x.${a}.apps.example.test`,`${a}.apps.example.test.evil`, 'unknown.apps.example.test']) assert.equal((await request(host,'/',{headers:{'x-forwarded-host':`${a}.apps.example.test`}})).status,421);
  const ticket=await issue(); assert.equal((await exchange(b,ticket)).status,401);
  assert.equal(db.prepare('SELECT token_hash FROM workspace_host_tickets').get().token_hash.includes(ticket),false);
  assert.equal((await request(`${a}.apps.example.test`,'/__host/exchange',{method:'POST',headers:{origin:`https://${b}.apps.example.test`,'content-type':'application/x-www-form-urlencoded'},body:`ticket=${ticket}`})).status,403);
  const redeemed=await exchange(a,ticket); assert.equal(redeemed.status,303); assert.equal((await exchange(a,ticket)).status,401);
  const set=redeemed.headers['set-cookie'][0]; assert.match(set,/^__Host-/); assert.match(set,/Secure/); assert.match(set,/HttpOnly/); assert.match(set,/SameSite=Lax/); assert.doesNotMatch(set,/Domain=/i);
  const cookie=set.split(';')[0];
  const guardedPath=path.join(root,'sites',a,'releases','1-aaaaaaaaaa','nested','app.js');
  const originalRead=fsSync.readFileSync;
  fsSync.readFileSync=function(filename,...args) {if(filename===guardedPath)throw new Error('whole-file synchronous read');return originalRead.call(this,filename,...args);};
  try { const streamed=await request(`${a}.apps.example.test`,'/nested/app.js',{headers:{cookie}});assert.equal(streamed.status,200);assert.equal(streamed.body,'ok'); }
  finally { fsSync.readFileSync=originalRead; }
  db.prepare('UPDATE workspace_pages SET entry_file=? WHERE id=?').run('nested/index.html',a);
  const entry=await request(`${a}.apps.example.test`,'/?view=one',{headers:{cookie}});
  assert.equal(entry.status,302);assert.equal(entry.headers.location,'/nested/index.html?view=one');
  assert.equal((await request(`${a}.apps.example.test`,'/nested/index.html',{headers:{cookie}})).status,200);
  assert.equal((await request(`${a}.apps.example.test`,'/nested/app.js',{headers:{cookie}})).status,200);
  assert.equal((await request(`${a}.apps.example.test`,'/')).status,401);
  db.prepare('UPDATE workspace_pages SET entry_file=? WHERE id=?').run('nested/100%.html',a);
  assert.equal((await request(`${a}.apps.example.test`,'/',{headers:{cookie}})).headers.location,'/nested/100%25.html');
  assert.equal((await request(`${a}.apps.example.test`,'/nested/100%25.html',{headers:{cookie}})).body,'percent');
  db.prepare('UPDATE workspace_pages SET entry_file=? WHERE id=?').run('index.html',a);
  const directory=await request(`${a}.apps.example.test`,'/nested?tab=one',{headers:{cookie}});
  assert.equal(directory.status,308);assert.equal(directory.headers.location,'/nested/?tab=one');
  assert.match((await request(`${a}.apps.example.test`,'/nested/',{headers:{cookie}})).body,/app\.js/);
  assert.equal((await request(`${a}.apps.example.test`,'/nested/',{method:'HEAD',headers:{cookie}})).status,200);
  assert.equal((await request(`${a}.apps.example.test`,'/nested/missing/',{headers:{cookie}})).status,404);
  assert.equal((await request(`${a}.apps.example.test`,'/',{headers:{cookie:`${cookie}; ${shareCookie}`}})).status,200);
  for (const url of ['/','/nested/app.js','/nested/style.css','/nested/image.png']) { const r=await request(`${a}.apps.example.test`,url,{headers:{cookie}}); assert.equal(r.status,200); assert.match(r.headers['cache-control'],/no-store/); assert.equal(r.headers['referrer-policy'],'no-referrer'); assert.match(r.headers['content-security-policy'],/worker-src 'none'/); assert.doesNotMatch(r.headers['content-security-policy'],/sandbox/); }
  for (const [url,type] of [['/','text/html'],['/nested/app.js','javascript'],['/nested/style.css','text/css'],['/nested/image.png','image/png']]) {
    const r=await request(`${a}.apps.example.test`,url,{headers:{cookie}});
    assert.ok(r.headers['content-type'].includes(type),`unexpected content type for ${url}`);
  }
  await fs.writeFile(path.join(root,'sites',a,'releases','1-aaaaaaaaaa','large.bin'),Buffer.alloc(24*1024*1024,7));
  const paused=await new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port:server.address().port,path:'/large.bin',headers:{host:`${a}.apps.example.test`,cookie}},res=>{res.once('data',()=>{res.pause();resolve({req,res});});res.on('error',reject);});req.on('error',reject);});
  let drained=false;const maintenance=gate.runExclusive(()=>{drained=true;});
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(drained,false);
  paused.res.destroy();paused.req.destroy();await maintenance;assert.equal(drained,true);
  const stalled=await new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port:server.address().port,path:'/large.bin',headers:{host:`${a}.apps.example.test`,cookie}},res=>{res.once('data',()=>{res.pause();resolve({req,res});});res.on('error',reject);});req.on('error',reject);});
  let deadline;try {
    await Promise.race([gate.runExclusive(()=>{}),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('stalled transfer blocked maintenance')),2000);})]);
  } finally {clearTimeout(deadline);stalled.res.destroy();stalled.req.destroy();}
  assert.equal((await request(`${b}.apps.example.test`,'/',{headers:{cookie}})).status,401);
  assert.equal((await request(`${a}.apps.example.test`,'/',{headers:{cookie:`${cookie}; ${cookie}`}})).status,401);
  for (const url of ['/../secret','/%2e%2e/secret','/nested%2f..%2fsecret','/nested/%5csecret']) assert.notEqual((await request(`${a}.apps.example.test`,url,{headers:{cookie}})).status,200);
  await fs.writeFile(path.join(root,'outside'),'secret');
  try { await fs.symlink(path.join(root,'outside'),path.join(root,'sites',a,'releases','1-aaaaaaaaaa','link')); assert.notEqual((await request(`${a}.apps.example.test`,'/link',{headers:{cookie}})).status,200); } catch (e) { if (!['EPERM','EACCES'].includes(e.code)) throw e; }
  db.prepare("DELETE FROM workspace_members WHERE user_id='bob'").run(); assert.equal((await request(`${a}.apps.example.test`,'/nested/app.js',{headers:{cookie}})).status,401);
  db.exec("INSERT INTO workspace_members VALUES ('team','bob','viewer','now')");
  assert.equal((await request(`${a}.apps.example.test`,'/',{headers:{cookie}})).status,401);
  const expired=await issue(); time+=30001; assert.equal((await exchange(a,expired)).status,401);
  const fresh=await exchange(a,await issue()); const freshCookie=fresh.headers['set-cookie'][0].split(';')[0]; time+=60001; assert.equal((await request(`${a}.apps.example.test`,'/',{headers:{cookie:freshCookie}})).status,401);
  const pending=await issue(); const active=await exchange(a,await issue()); const activeCookie=active.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request('manage.example.test',`/manage/${a}/authorizations`,{method:'DELETE',headers:{'x-user':'bob'}})).status,204); assert.equal((await exchange(a,pending)).status,401);
  assert.equal((await request(`${a}.apps.example.test`,'/',{headers:{cookie:activeCookie}})).status,401);
});
