import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMaintenanceGate } from '../server/maintenance.js';
import express from 'express';
import http from 'node:http';
import { createAccountRouter } from '../server/account-router.js';
import { createWorkspaceShareRouter } from '../server/workspace-share-router.js';

test('maintenance rejects new requests and waits for asynchronous work after disconnect', async () => {
  const gate=createMaintenanceGate(), req={}, res=new EventEmitter();
  let passed=false; gate.middleware(req,res,()=>{passed=true;}); assert.equal(passed,true);
  const release=req.maintenance.retain();
  let ran=false;
  const work=gate.runExclusive(async()=>{assert.equal(gate.isQuiescent(),true);ran=true;});
  const rejected={headers:{},set(name,value){this.headers[name]=value;return this;},status(code){this.code=code;return this;},send(){this.sent=true;}};
  gate.middleware({},rejected,()=>assert.fail('request was accepted'));
  assert.equal(rejected.code,503); assert.equal(rejected.headers['Retry-After'],'5');
  res.emit('close'); await Promise.resolve(); assert.equal(ran,false);
  release(); release(); await work; assert.equal(ran,true); assert.equal(gate.isQuiescent(),false);
  let reopened=false; const nextRes=new EventEmitter(); gate.middleware({},nextRes,()=>{reopened=true;}); assert.equal(reopened,true);nextRes.emit('finish');
});

test('maintenance restores service after failure and rejects overlapping runs', async () => {
  const gate=createMaintenanceGate(); let resume;
  const first=gate.runExclusive(()=>new Promise(resolve=>{resume=resolve;}));
  await Promise.resolve();
  await assert.rejects(gate.runExclusive(async()=>{}),/already active/);
  resume();await first;
  await assert.rejects(gate.runExclusive(async()=>{throw Error('failure');}),/failure/);
  let opened=false;const res=new EventEmitter();gate.middleware({},res,()=>{opened=true;});assert.equal(opened,true);res.emit('close');
});

test('a request can enter maintenance without waiting for itself, while other work drains', async () => {
  const gate=createMaintenanceGate(), req={}, res=new EventEmitter(), other={}, otherRes=new EventEmitter();
  gate.middleware(req,res,()=>{}); gate.middleware(other,otherRes,()=>{});
  const release=other.maintenance.retain();
  let entered=false;
  const work=req.maintenance.runExclusive(()=>{assert.equal(gate.isQuiescent(),true);entered=true;});
  const blocked={set(){return this;},status(code){this.code=code;return this;},send(){return this;}};
  gate.middleware({},blocked,()=>assert.fail('request accepted during maintenance'));
  assert.equal(blocked.code,503); otherRes.emit('close'); await Promise.resolve(); assert.equal(entered,false);
  release(); await work; assert.equal(entered,true); res.emit('finish');
  const next={},nextRes=new EventEmitter(); gate.middleware(next,nextRes,()=>{});nextRes.emit('finish');
});

test('a failed storage recovery can leave the service closed until restart',async()=>{
 const gate=createMaintenanceGate();
 assert.throws(()=>gate.failClosed(),/exclusive/i);
 await assert.rejects(gate.runExclusive(async()=>{gate.failClosed();throw Error('recovery failed');}),/recovery failed/);
 const res={set(){return this;},status(code){this.code=code;return this;},send(){return this;}};
 gate.middleware({},res,()=>assert.fail('service reopened after failed recovery'));
 assert.equal(res.code,503);
 await assert.rejects(gate.runExclusive(async()=>{}),/already active/);
});

for (const kind of ['account','share']) test(`maintenance waits for disconnected ${kind} operations`,async t=>{
  const gate=createMaintenanceGate(),app=express();let entered,resume,closed;
  const started=new Promise(resolve=>{entered=resolve;}), wait=new Promise(resolve=>{resume=resolve;}), disconnected=new Promise(resolve=>{closed=resolve;});
  app.use((req,res,next)=>{res.once('close',closed);next();});app.use(gate.middleware);
  if(kind==='account') app.use('/account',createAccountRouter({accounts:{register:async()=>{entered();await wait;}},sessions:{},allowedOrigins:['https://manage.hostlet.test'],registrationEnabled:true}));
  else app.use('/shares',createWorkspaceShareRouter({service:{create:async()=>{entered();await wait;return {};},issue:async()=>null,list:()=>[],revoke:()=>{}},requireUser:(req,res,next)=>{req.user={id:'u'};next();},managementOrigin:'https://manage.hostlet.test'}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=http.request({host:'127.0.0.1',port:server.address().port,path:kind==='account'?'/account/register':'/shares/w/pages/p',method:'POST',headers:{host:'manage.hostlet.test',origin:'https://manage.hostlet.test','content-type':'application/json'}});
  request.on('error',()=>{});request.end('{}');await started;request.destroy();await disconnected;
  let exclusive=false;const work=gate.runExclusive(async()=>{exclusive=true;});
  await Promise.resolve();const startedEarly=exclusive;resume();await work;
  assert.equal(startedEarly,false);assert.equal(exclusive,true);
});
