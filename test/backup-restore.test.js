import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import JSZip from 'jszip';
import {openDatabase} from '../server/database.js';
import {loadConfig} from '../server/config.js';
import {createApps} from '../server/app.js';

test('offline data-directory backup restores a private app and its resources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-backup-'));
 const dataDir=path.join(root,'data'),backupDir=path.join(root,'backup'),failedDir=path.join(root,'failed');
 const messages=[];let running;
 const config=loadConfig({ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:dataDir});
 config.registrationEnabled=true;config.hosting={appDomain:'apps.example.test',managementOrigin:'https://admin.hostlet.test'};
 const stop=async()=>{if(!running)return;const old=running;running=null;await Promise.all([new Promise(r=>old.admin.close(r)),new Promise(r=>old.hosted.close(r))]);old.db.close();};
 t.after(async()=>{await stop();await fs.rm(root,{recursive:true,force:true});});
 const start=async()=>{
  const db=openDatabase(path.join(dataDir,'hostlet.sqlite'));
  try {
   const apps=await createApps({config,db,accountSender:async message=>messages.push(message)});
   const admin=http.createServer(apps.admin),hosted=http.createServer(apps.hosted);
   await Promise.all([new Promise(r=>admin.listen(0,'127.0.0.1',r)),new Promise(r=>hosted.listen(0,'127.0.0.1',r))]);
   const base=`http://127.0.0.1:${admin.address().port}`;config.allowedOrigins.splice(0,config.allowedOrigins.length,base);
   running={db,admin,hosted,base};return running;
  } catch(e){db.close();throw e;}
 };
 const post=(url,body,cookie)=>fetch(running.base+url,{method:'POST',headers:{Origin:running.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const hosted=(pageId,pathname,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:running.hosted.address().port,path:pathname,method,headers:{host:`${pageId}.apps.example.test`,...headers}},res=>{
   let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data}));
  });req.on('error',reject);req.end(body);
 });
 await start();
 assert.equal((await post('/api/account/register',{email:'backup@example.test',password:'sufficiently long test password'})).status,202);
 assert.equal((await post('/api/account/verify',{token:messages[0].token})).status,200);
 const login=await post('/api/account/login',{email:'backup@example.test',password:'sufficiently long test password'});assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie()[0].split(';')[0];
 const spaces=await fetch(running.base+'/api/workspaces',{headers:{Cookie:cookie}});const workspace=(await spaces.json())[0].id;
 const zip=new JSZip();zip.file('index.html','<link rel="stylesheet" href="assets/app.css">');zip.file('assets/app.css','body { color: red; }');
 const data=new FormData();data.set('title','Backup example');data.set('file',new Blob([await zip.generateAsync({type:'nodebuffer'})]),'site.zip');
 const upload=await fetch(`${running.base}/api/workspaces/${workspace}/pages`,{method:'POST',headers:{Origin:running.base,Cookie:cookie},body:data});assert.equal(upload.status,201);
 const page=(await upload.json()).page;
 await stop();await fs.cp(dataDir,backupDir,{recursive:true,errorOnExist:true});
 await start();
 assert.equal((await fetch(`${running.base}/api/workspaces/${workspace}/pages/${page.id}`,{method:'DELETE',headers:{Origin:running.base,Cookie:cookie}})).status,204);
 await stop();await fs.rename(dataDir,failedDir);await fs.cp(backupDir,dataDir,{recursive:true,errorOnExist:true});await start();
 assert.equal(running.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(running.db.prepare('PRAGMA foreign_key_check').all().length,0);
 const restored=await fetch(`${running.base}/api/workspaces/${workspace}/pages/${page.id}`,{headers:{Cookie:cookie}});assert.equal(restored.status,200);assert.equal((await restored.json()).page.releaseId,page.releaseId);
 assert.equal((await hosted(page.id,'/')).status,401);
 const ticket=await post(`/api/host/${page.id}/tickets`,{},cookie);assert.equal(ticket.status,201);
 const exchange=await hosted(page.id,'/__host/exchange',{method:'POST',headers:{origin:'https://admin.hostlet.test','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:(await ticket.json()).ticket}).toString()});
 assert.equal(exchange.status,303);const appCookie=exchange.headers['set-cookie'][0].split(';')[0];
 const html=await hosted(page.id,'/',{headers:{cookie:appCookie}}),css=await hosted(page.id,'/assets/app.css',{headers:{cookie:appCookie}});
 assert.equal(html.status,200);assert.match(html.data,/assets\/app\.css/);assert.equal(css.status,200);assert.match(css.data,/color: red/);
});
