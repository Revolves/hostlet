import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { workspaceShareSchema, createWorkspaceShareService } from '../server/workspace-shares.js';
import { createWorkspaceShareRouter } from '../server/workspace-share-router.js';

async function setup(t, options={}) {
  const db=new DatabaseSync(':memory:'); db.exec("PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE workspace_pages(id TEXT PRIMARY KEY,workspace_id TEXT,access_mode TEXT); INSERT INTO workspaces VALUES ('w'); INSERT INTO workspace_pages VALUES ('p','w','private');"); db.exec(workspaceShareSchema);
  const service=createWorkspaceShareService({db,authorize:(_w,actor)=>{if(actor!=='owner' && actor!=='editor') throw Object.assign(new Error(),{code:'FORBIDDEN'});},limitAttempt:()=>true});
  const app=express(); app.use('/shares',createWorkspaceShareRouter({service,managementOrigin:'https://manage.hostlet.test',requireUser:(req,res,next)=>{if(!req.headers['x-user']) return res.sendStatus(401); req.user={id:req.headers['x-user']};next();},...options}));
  const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  t.after(()=>{server.close();db.close();});
  const call=(url,{method='GET',body,origin='https://manage.hostlet.test',user,host='manage.hostlet.test'}={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/shares'+url,method,headers:{host,origin,...(user?{'x-user':user}:{}),...(body?{'content-type':'application/json'}:{})}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:data,headers:res.headers}));});req.on('error',reject);req.end(body && JSON.stringify(body));});
  return {call,service,db};
}

test('management permissions, strict origin and anonymous ticket issue', async t=>{
  const {call}=await setup(t);
  const create=(user,origin)=>call('/w/pages/p',{method:'POST',user,origin,body:{password:'private'}});
  assert.equal((await create('owner','https://evil.test')).status,403);
  assert.equal((await create(undefined)).status,401);
  assert.equal((await create('viewer')).status,403);
  const created=await create('editor'); assert.equal(created.status,201);
  const share=JSON.parse(created.body).share;
  const listed=await call('/w/pages/p',{user:'owner'}); assert.equal(listed.status,200); assert.equal(JSON.parse(listed.body).shares[0].id,share.id); assert.ok(!listed.body.includes(share.token));
  assert.equal((await call('/w/pages/p/list',{method:'POST',user:'owner'})).status,200);
  assert.equal((await call('/ticket',{method:'POST',origin:'https://evil.test',body:{pageId:'p',token:share.token,password:'private'}})).status,403);
  assert.equal((await call('/ticket',{method:'POST',body:{pageId:'p',token:share.token,password:'bad'}})).status,401);
  const ticket=await call('/ticket',{method:'POST',body:{pageId:'p',token:share.token,password:'private'}}); assert.equal(ticket.status,201); assert.ok(JSON.parse(ticket.body).ticket); assert.match(ticket.headers['cache-control'],/no-store/);
  assert.equal((await call('/ticket?token=secret',{method:'POST',body:{pageId:'p',token:share.token}})).status,400);
  assert.equal((await call('/ticket',{method:'POST',host:'other.test',body:{pageId:'p',token:share.token}})).status,403);
  assert.equal((await call(`/w/pages/p/${share.id}`,{method:'DELETE',user:'owner'})).status,204);
  assert.equal((await call('/ticket',{method:'POST',body:{pageId:'p',token:share.token,password:'private'}})).status,401);
});

test('bounded limiter counts invalid attempts and fails closed at capacity', async t=>{
  const {call}=await setup(t,{rateLimit:{ipLimit:2,pageLimit:10,globalLimit:20,maxBuckets:1,windowMs:60000}});
  const body={pageId:'p',token:'bad'};
  assert.equal((await call('/ticket',{method:'POST',body})).status,401);
  assert.equal((await call('/ticket',{method:'POST',body})).status,401);
  assert.equal((await call('/ticket',{method:'POST',body})).status,429);
});

test('page buckets have a hard cap and malformed requests consume IP quota', async t=>{
  const {call}=await setup(t,{rateLimit:{ipLimit:4,pageLimit:10,globalLimit:20,maxBuckets:1,windowMs:60000}});
  assert.equal((await call('/ticket',{method:'POST',body:{pageId:'p',token:'bad'}})).status,401);
  assert.equal((await call('/ticket',{method:'POST',body:{pageId:'new',token:'bad'}})).status,429);
  assert.equal((await call('/ticket',{method:'POST',body:{unexpected:true}})).status,400);
  assert.equal((await call('/ticket',{method:'POST',body:{unexpected:true}})).status,400);
  assert.equal((await call('/ticket',{method:'POST',body:{unexpected:true}})).status,429);
});
