import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { acquireInstanceLock } from '../server/instance-lock.js';
import { openDatabase } from '../server/database.js';
import { loadConfig } from '../server/config.js';

test('bind address must be a literal IP when configured',()=>{
 const base={ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef'};
 assert.equal(loadConfig({...base,BIND_ADDRESS:'127.0.0.1'}).bindAddress,'127.0.0.1');
 assert.throws(()=>loadConfig({...base,BIND_ADDRESS:'localhost'}),/BIND_ADDRESS/);
});

test('server can restrict both listeners to the selected loopback address',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-bind-'));
 const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const adminPort=await freePort();let pagesPort=await freePort();while(pagesPort===adminPort)pagesPort=await freePort();
 const env={...process.env,ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:root,ADMIN_PORT:String(adminPort),PAGES_PORT:String(pagesPort),BIND_ADDRESS:'127.0.0.1',MULTIUSER_ENABLED:'false'};
 const child=spawn(process.execPath,[fileURLToPath(new URL('../server/index.js',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error(`server startup timed out: ${errors}`)),15000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Hostlet workspace:')){clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>{errors+=chunk;});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}: ${errors}`));});});
 const connect=(port,host)=>new Promise(resolve=>{const socket=net.connect({port,host});socket.setTimeout(2000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
 for(const port of [adminPort,pagesPort]){assert.equal(await connect(port,'127.0.0.1'),true);assert.equal(await connect(port,'127.0.0.2'),false);}
});

test('only one instance may own a data directory and a released lock can be reacquired', t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-lock-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const first=acquireInstanceLock(root);
 assert.throws(()=>acquireInstanceLock(root),/already in use/i);
 first.release(); first.release();
 const second=acquireInstanceLock(root); second.release();
});

test('an abruptly terminated process leaves its lock for explicit offline recovery',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-lock-crash-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const moduleUrl=new URL('../server/instance-lock.js',import.meta.url).href;
 const code=`import { acquireInstanceLock } from ${JSON.stringify(moduleUrl)}; acquireInstanceLock(process.argv[1]); process.stdout.write('ready\\n'); setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,root],{stdio:['ignore','pipe','pipe']});
 const output=await new Promise((resolve,reject)=>{child.stdout.once('data',chunk=>resolve(String(chunk)));child.once('error',reject);child.once('exit',code=>reject(Error(`child exited ${code}`)));});
 assert.match(output,/ready/); assert.throws(()=>acquireInstanceLock(root),/already in use/i);
 const exited=new Promise(resolve=>child.once('exit',resolve)); child.kill(); await exited;
 assert.throws(()=>acquireInstanceLock(root),/already in use/i);
});

test('the server rejects a second process before opening the same database',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-server-lock-'));
 const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const port1=await freePort();let port2=await freePort();while(port2===port1)port2=await freePort();
 const env={...process.env,ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:root,ADMIN_PORT:String(port1),PAGES_PORT:String(port2),MULTIUSER_ENABLED:'false'};
 const entry=fileURLToPath(new URL('../server/index.js',import.meta.url));
 const start=()=>spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe']});
 const first=start();
 t.after(async()=>{if(first.exitCode===null){const done=new Promise(resolve=>first.once('exit',resolve));first.kill();await done;}fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error(`first process startup timed out: ${errors}`)),15000);first.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Hostlet workspace:')){clearTimeout(timer);resolve();}});first.stderr.on('data',chunk=>{errors+=chunk;});first.once('error',error=>{clearTimeout(timer);reject(error);});first.once('exit',code=>{clearTimeout(timer);reject(Error(`first process exited ${code}: ${errors}`));});});
 const second=start();let errors='';second.stderr.on('data',chunk=>{errors+=chunk;});
 const code=await new Promise(resolve=>second.once('exit',resolve));
 assert.notEqual(code,0);assert.match(errors,/Data directory is already in use/);
});

test('a port binding failure closes the partial startup and releases its lock',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-start-fail-'));
 const occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,resolve));
 t.after(async()=>{await new Promise(resolve=>occupied.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,resolve));const adminPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const env={...process.env,ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:root,ADMIN_PORT:String(adminPort),PAGES_PORT:String(occupied.address().port),MULTIUSER_ENABLED:'false'};
 const child=spawn(process.execPath,[fileURLToPath(new URL('../server/index.js',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',chunk=>{errors+=chunk;});const code=await new Promise(resolve=>child.once('exit',resolve));
 assert.notEqual(code,0);assert.match(errors,/Startup failed/);
 const lock=acquireInstanceLock(root);lock.release();
});

test('a graceful shutdown drains the server and releases the data directory',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-stop-'));
 const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
 const adminPort=await freePort();let pagesPort=await freePort();while(pagesPort===adminPort)pagesPort=await freePort();
 const env={...process.env,ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:root,ADMIN_PORT:String(adminPort),PAGES_PORT:String(pagesPort),MULTIUSER_ENABLED:'false'};
 const entry=new URL('../server/index.js',import.meta.url).href;
 const script=`process.stdin.once('data',()=>{process.stdin.pause();process.emit('SIGTERM');}); await import(${JSON.stringify(entry)});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{env,stdio:['pipe','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let errors='';const timer=setTimeout(()=>reject(Error(`server startup timed out: ${errors}`)),15000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Hostlet workspace:')){clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>{errors+=chunk;});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`unexpected exit ${code}: ${errors}`));});});
 const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end('stop');assert.equal(await exited,0);
 const lock=acquireInstanceLock(root);lock.release();
});

test('multiuser server starts expired-record cleanup and shuts it down cleanly',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostlet-cleanup-start-'));
 const db=openDatabase(path.join(root,'hostlet.sqlite'));
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('test-user','test@example.org','hash',1,1);
 db.prepare('INSERT INTO account_sessions VALUES (?,?,?,?)').run('expired','test-user',0,0);db.close();
 const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
 const adminPort=await freePort();let pagesPort=await freePort();while(pagesPort===adminPort)pagesPort=await freePort();
 const env={...process.env,ADMIN_PASSWORD:'test-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:root,ADMIN_PORT:String(adminPort),PAGES_PORT:String(pagesPort),MULTIUSER_ENABLED:'true',SMTP_HOST:'localhost',SMTP_FROM:'test@example.org',APPS_DOMAIN:''};
 const entry=new URL('../server/index.js',import.meta.url).href;
 const script=`process.stdin.once('data',()=>{process.stdin.pause();process.emit('SIGTERM');}); await import(${JSON.stringify(entry)});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{env,stdio:['pipe','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let errors='';const timer=setTimeout(()=>reject(Error(`server startup timed out: ${errors}`)),15000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Hostlet workspace:')){clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>{errors+=chunk;});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`unexpected exit ${code}: ${errors}`));});});
 const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end('stop');assert.equal(await exited,0);
 const restored=openDatabase(path.join(root,'hostlet.sqlite'));try{assert.equal(restored.prepare('SELECT count(*) n FROM account_sessions').get().n,0);}finally{restored.close();}
 const lock=acquireInstanceLock(root);lock.release();
});
