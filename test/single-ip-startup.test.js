import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
test('explicit trusted single-IP configuration starts the normal application entry point',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ip-start-'));const adminPort=await freePort();let pagesPort=await freePort();while(pagesPort===adminPort)pagesPort=await freePort();
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server/index.js',import.meta.url))],{env:{...process.env,
    ADMIN_PASSWORD:'startup-test-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:dir,BIND_ADDRESS:'127.0.0.1',
    ADMIN_PORT:String(adminPort),PAGES_PORT:String(pagesPort),MULTIUSER_ENABLED:'true',SMTP_HOST:'unused.invalid',SMTP_FROM:'test@example.invalid',
    COOKIE_SECURE:'true',REGISTRATION_ENABLED:'false',ADMIN_ORIGINS:'',APPS_DOMAIN:'',ADMIN_ORIGIN:`https://127.0.0.1:${adminPort}`,SINGLE_IP_CONTENT_ORIGIN:`https://127.0.0.1:${pagesPort}`},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}await fs.rm(dir,{recursive:true,force:true});});
  let out='',err='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timed out waiting for single-IP startup: ${err}`)),15000);child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Unexpected exit ${code}: ${err}`));});child.stdout.on('data',()=>{if(out.includes('Hostlet workspace:') && out.includes('Hosted pages:')){clearTimeout(timer);resolve();}});});
  assert.match(out,/Hosted pages:/);
});
