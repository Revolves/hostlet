import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createWorkspaceIpHostingRouter } from '../server/workspace-ip-hosting.js';

const a='w-'+ 'a'.repeat(32), b='w-'+ 'b'.repeat(32);
async function setup(t, options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ip-host-'));
  for (const id of [a,b]) { const dir=path.join(root,'sites',id,'releases','1-aaaaaaaaaa'); await fs.mkdir(path.join(dir,'sub'),{recursive:true}); await fs.writeFile(path.join(dir,'index.html'),id); await fs.writeFile(path.join(dir,'sub','index.html'),'nested'); await fs.writeFile(path.join(dir,'sub','app.js'),'ok'); }
  let enabled=true, pub=false; const tickets=new Map(), sessions=new Map();
  const service={storageRoot:root,managementOrigin:'https://127.0.0.1:30006',issue(id){const value=`ticket-${id}`; tickets.set(value,id); return value;},exchange(id,value){if(!enabled || tickets.get(value)!==id)return null;tickets.delete(value);const session=`session-${id}`;sessions.set(session,id);return {value:session,maxAge:60000};},authorize(id,value){return enabled && sessions.get(value)===id ? row(id):null;},publicPage(id){return enabled && pub ? row(id):null;}};
  function row(id){return {id,storage_id:id,release_id:'1-aaaaaaaaaa',entry_file:'index.html'};}
  const app=express(); if(options.trustProxy!==undefined) app.set('trust proxy',options.trustProxy); app.use((req,res,next)=>{res.setHeader('Set-Cookie','admin=bad');next();}); app.use(createWorkspaceIpHostingRouter({service,contentHost:'127.0.0.1:30007',isSuspended:options.isSuspended || (()=>!enabled),rateLimit:options.rateLimit}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const request=(url,{method='GET',host='127.0.0.1:30007',headers={},body,localAddress}={})=>new Promise((resolve,reject)=>{const q=http.request({host:'127.0.0.1',port:server.address().port,localAddress,path:url,method,headers:{host,...headers}},r=>{let data='';r.on('data',c=>data+=c);r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:data}));});q.on('error',reject);q.end(body);});
  const exchange=(id,ticket)=>request(`/p/${id}/__host/exchange`,{method:'POST',headers:{origin:service.managementOrigin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket}).toString()});
  return {request,exchange,service,disable:()=>enabled=false,makePublic:()=>pub=true};
}

test('exact host, one-use member sessions, current-page checks and scoped cookies',async t=>{
  const x=await setup(t); const ticket=x.service.issue(a);
  assert.equal((await x.request(`/p/${a}/`,{host:'127.0.0.1:30006'})).status,421);
  assert.equal((await x.exchange(b,ticket)).status,401);
  const e=await x.exchange(a,ticket); assert.equal(e.status,303); assert.equal(e.headers.location,`/p/${a}/`);
  assert.equal((await x.exchange(a,ticket)).status,401);
  assert.equal(e.headers['set-cookie'].length,1); assert.match(e.headers['set-cookie'][0],new RegExp(`Path=/p/${a}/`)); assert.match(e.headers['set-cookie'][0],/HttpOnly.*Secure|Secure.*HttpOnly/);
  const cookie=e.headers['set-cookie'][0].split(';')[0];
  assert.equal((await x.request(`/p/${a}/sub/app.js`,{headers:{cookie}})).body,'ok');
  assert.equal((await x.request(`/p/${b}/`,{headers:{cookie}})).status,401);
  assert.equal((await x.request(`/p/${a}/sub`,{headers:{cookie}})).headers.location,`/p/${a}/sub/`);
  assert.equal((await x.request(`/p/${a}/sub/`,{headers:{cookie}})).body,'nested');
  x.disable(); assert.equal((await x.request(`/p/${a}/sub/app.js`,{headers:{cookie}})).status,401);
});

test('public files retain headers, reject traversal and do not forward cookies',async t=>{
 const x=await setup(t); x.makePublic();
 const r=await x.request(`/p/${a}/`); assert.equal(r.status,200); assert.equal(r.headers['set-cookie'],undefined); assert.match(r.headers['content-security-policy'],/worker-src 'none'/); assert.match(r.headers['cache-control'],/no-store/);
 for(const p of ['%2e%2e/secret','sub%2f..%2findex.html','sub%5cindex.html','%00']) assert.equal((await x.request(`/p/${a}/${p}`)).status,404);
 assert.equal((await x.request(`/p/${a}/`,{method:'POST'})).status,405);
});


test('real member and share services recheck revocation, membership and suspension on resources',async t=>{
 const { DatabaseSync }=await import('node:sqlite');
 const { workspaceSchema }=await import('../server/workspaces.js');
 const { workspacePagesSchema }=await import('../server/workspace-pages.js');
 const { workspaceHostingSchema,createWorkspaceHostingService }=await import('../server/workspace-hosting.js');
 const { workspaceShareSchema,createWorkspaceShareService }=await import('../server/workspace-shares.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ip-real-')); const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY);'); db.exec(workspaceSchema); db.exec(workspacePagesSchema); db.exec(workspaceHostingSchema); db.exec(workspaceShareSchema);
 db.exec("INSERT INTO users VALUES ('alice'),('bob'); INSERT INTO workspaces VALUES ('team','Team','team','alice','now'); INSERT INTO workspace_members VALUES ('team','alice','owner','now'),('team','bob','viewer','now');");
 db.prepare('INSERT INTO workspace_page_ids VALUES (?)').run(a); db.prepare('INSERT INTO workspace_pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(a,'team','alice','Title','private',a,'1-aaaaaaaaaa','index.html','zip','x.zip',1,1,'now','now');
 const dir=path.join(root,'sites',a,'releases','1-aaaaaaaaaa'); await fs.mkdir(dir,{recursive:true}); await fs.writeFile(path.join(dir,'index.html'),'ok');
 let suspended=false; const service=createWorkspaceHostingService({db,storageRoot:root,appDomain:'apps.example.test',managementOrigin:'https://manage.hostlet.test',isSuspended:()=>suspended});
 const shares=createWorkspaceShareService({db,authorize:()=>{},limitAttempt:()=>true});
 const app=express(); app.use(createWorkspaceIpHostingRouter({service,shareService:shares,contentHost:'127.0.0.1:30007',isSuspended:()=>suspended}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}); t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();await fs.rm(root,{recursive:true,force:true});});
 const call=(suffix,{method='GET',cookie,ticket}={})=>new Promise((resolve,reject)=>{const q=http.request({host:'127.0.0.1',port:server.address().port,path:`/p/${a}/${suffix}`,method,headers:{host:'127.0.0.1:30007',...(cookie?{cookie}:{}),...(ticket?{origin:service.managementOrigin,'content-type':'application/x-www-form-urlencoded'}:{})}},r=>{r.resume();r.on('end',()=>resolve(r));});q.on('error',reject);q.end(ticket?new URLSearchParams({ticket}).toString():undefined);});
 const memberTicket=service.issue(a,'bob'); const member=await call('__host/exchange',{method:'POST',ticket:memberTicket}); assert.equal(member.statusCode,303); const memberCookie=member.headers['set-cookie'][0].split(';')[0];
 const share=await shares.create('team','alice',a,{}); const shareTicket=await shares.issue(a,share.token,undefined,'client'); const exchanged=await call('__host/exchange',{method:'POST',ticket:shareTicket}); assert.equal(exchanged.statusCode,303); const shareCookie=exchanged.headers['set-cookie'][0].split(';')[0];
 assert.equal((await call('',{cookie:memberCookie})).statusCode,200); assert.equal((await call('',{cookie:shareCookie})).statusCode,200);
 suspended=true; assert.equal((await call('',{cookie:shareCookie})).statusCode,401); suspended=false;
 shares.revoke('team','alice',a,share.id); assert.equal((await call('',{cookie:shareCookie})).statusCode,401);
 db.prepare("DELETE FROM workspace_members WHERE workspace_id='team' AND user_id='bob'").run(); assert.equal((await call('',{cookie:memberCookie})).statusCode,401);
});

test('rejects bad configuration and conceals service exceptions',async t=>{
 assert.throws(()=>createWorkspaceIpHostingRouter({contentHost:'example.test:30007'}),/configuration/);
 const x=await setup(t); x.service.publicPage=()=>{throw new Error('secret-path');};
 const r=await x.request(`/p/${a}/`); assert.equal(r.status,500); assert.doesNotMatch(r.body,/secret-path/); assert.equal(r.headers['set-cookie'],undefined);
 const bad=await x.request(`/p/${a}/__host/exchange`,{method:'POST',headers:{origin:'https://evil.test','content-type':'application/x-www-form-urlencoded'},body:'ticket=test'}); assert.equal(bad.status,403);
});


test('page-scoped sessions coexist and duplicate cookies fail closed',async t=>{
 const x=await setup(t); const ea=await x.exchange(a,x.service.issue(a)); const eb=await x.exchange(b,x.service.issue(b));
 const ca=ea.headers['set-cookie'][0].split(';')[0], cb=eb.headers['set-cookie'][0].split(';')[0];
 assert.notEqual(ca.split('=')[0],cb.split('=')[0]);
 assert.equal((await x.request(`/p/${a}/`,{headers:{cookie:`${ca}; ${cb}`}})).status,200);
 assert.equal((await x.request(`/p/${b}/`,{headers:{cookie:`${ca}; ${cb}`}})).status,200);
 assert.equal((await x.request(`/p/${a}/`,{headers:{cookie:`${ca}; ${ca}`}})).status,401);
});

test('exchange rejects oversized and malformed bodies without consuming tickets',async t=>{
 const x=await setup(t); const ticket=x.service.issue(a); let exchanges=0;
 const original=x.service.exchange; x.service.exchange=(...args)=>{exchanges++;return original(...args);};
 const headers={origin:x.service.managementOrigin,'content-type':'application/x-www-form-urlencoded'};
 for(const [body,extra,status] of [
   [`ticket=${'x'.repeat(1100)}`,{},413],
   ['ticket=a&extra=b&extra2=c',{},413],
   ['not-gzip',{'content-encoding':'gzip'},400],
 ]) {
   const response=await x.request(`/p/${a}/__host/exchange`,{method:'POST',headers:{...headers,...extra},body});
   assert.equal(response.status,status); assert.equal(response.headers['set-cookie'],undefined); assert.doesNotMatch(response.body,/gzip|ticket|stack/i);
 }
 assert.equal(exchanges,0);
 assert.equal((await x.exchange(a,ticket)).status,303);
});

test('per-IP rate limit ignores spoofed forwarding headers and runs before suspension, parsing and exchange',async t=>{
 let checks=0, time=1000;
 const x=await setup(t,{isSuspended:()=>{checks++;return false;},rateLimit:{windowMs:1000,perIp:2,global:10,maxEntries:10,now:()=>time}});
 const ticket=x.service.issue(a), headers={origin:x.service.managementOrigin,'content-type':'application/x-www-form-urlencoded'};
 const call=(id,body,extra={})=>x.request(`/p/${id}/__host/exchange`,{method:'POST',headers:{...headers,...extra},body});
 assert.equal((await call(a,'ticket=bad',{'x-forwarded-for':'1.1.1.1'})).status,401);
 assert.equal((await call(b,'ticket=bad',{'x-forwarded-for':'2.2.2.2'})).status,401);
 const denied=await call(a,`ticket=${'x'.repeat(2000)}`,{'x-forwarded-for':'3.3.3.3'});
 assert.equal(denied.status,429); assert.equal(denied.headers['set-cookie'],undefined); assert.equal(checks,2);
 time+=1000; assert.equal((await call(a,`ticket=${ticket}`)).status,303);
});

test('different socket IPs have independent quotas, while global quota applies to all',async t=>{
 const x=await setup(t,{rateLimit:{windowMs:1000,perIp:1,global:2,maxEntries:5,now:()=>1000}});
 const call=localAddress=>x.request(`/p/${a}/__host/exchange`,{method:'POST',localAddress,headers:{origin:x.service.managementOrigin,'content-type':'application/x-www-form-urlencoded'},body:'ticket=bad'});
 assert.equal((await call('127.0.0.1')).status,401);
 assert.equal((await call('127.0.0.2')).status,401);
 assert.equal((await call('127.0.0.3')).status,429);
});

test('trusted proxy supplies distinct client IPs and cannot make an exhausted client bypass its quota',async t=>{
 const x=await setup(t,{trustProxy:'loopback',rateLimit:{windowMs:1000,perIp:1,global:10,maxEntries:10,now:()=>1000}});
 const call=xff=>x.request(`/p/${a}/__host/exchange`,{method:'POST',headers:{origin:x.service.managementOrigin,'content-type':'application/x-www-form-urlencoded','x-forwarded-for':xff},body:'ticket=bad'});
 assert.equal((await call('198.51.100.1')).status,401);
 assert.equal((await call('198.51.100.2')).status,401);
 assert.equal((await call('203.0.113.10, 198.51.100.1')).status,429);
});

test('IP cache stays bounded without evicting active quotas and expired entries are reclaimed',async t=>{
 let time=1000; const x=await setup(t,{rateLimit:{windowMs:1000,perIp:1,global:20,maxEntries:1,now:()=>time}});
 const call=localAddress=>x.request(`/p/${a}/__host/exchange`,{method:'POST',localAddress,headers:{origin:x.service.managementOrigin,'content-type':'application/x-www-form-urlencoded'},body:'ticket=bad'});
 assert.equal((await call('127.0.0.1')).status,401);
 assert.equal((await call('127.0.0.2')).status,429);
 assert.equal((await call('127.0.0.1')).status,429);
 time+=1000; assert.equal((await call('127.0.0.2')).status,401);
});
