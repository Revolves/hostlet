// Linux-only disposable proxy lab. Supply a trusted, unpacked Ubuntu nginx 1.18
// binary and a dedicated writable directory through the two HOSTLET_LAB variables.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {openDatabase} from '../../server/database.js';
import {loadConfig} from '../../server/config.js';
import {createApps} from '../../server/app.js';

const parent=process.env.HOSTLET_LAB_ROOT,source=process.env.HOSTLET_LAB_NGINX;
if (!parent || !source || !path.isAbsolute(parent) || !path.isAbsolute(source)) throw new Error('Set absolute HOSTLET_LAB_ROOT and HOSTLET_LAB_NGINX paths');
const root=await fsp.mkdtemp(path.join(parent,'nginx-app-'));
let admin,hosted,nginx,db;
const listen=(s,ip)=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(30007,ip,resolve);});
const close=s=>s?.listening?new Promise(resolve=>s.close(resolve)):Promise.resolve();
const origin='https://admin.example.org:30006',domain='apps.exampleusercontent.net:30006';
function request(host,url,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{const req=https.request({host:'127.0.0.1',port:30006,servername:host,path:url,method,rejectUnauthorized:false,agent:false,headers:{host:`${host}:30006`,...headers}},res=>{let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);});}
const post=(url,body,cookie)=>request('admin.example.org',url,{method:'POST',body:JSON.stringify(body),headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})}});
try {
 const executable=fs.readFileSync(source),needle=Buffer.from('/var/log/nginx/error.log\0'),offset=executable.indexOf(needle);
 assert.ok(offset>=0 && executable.indexOf(needle,offset+1)<0,'unexpected nginx binary');
 executable.fill(0,offset,offset+needle.length);executable.write('/dev/null',offset);
 const binary=path.join(root,'nginx'),key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem'),conf=path.join(root,'nginx.conf');fs.writeFileSync(binary,executable,{mode:0o700});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=admin.example.org'],{stdio:'ignore'});
 let text=fs.readFileSync(new URL('../../deploy/nginx.example.conf',import.meta.url),'utf8')
  .replace('pid /var/run/nginx.pid;',`pid ${root}/nginx.pid;`)
  .replace('http {',`http { client_body_temp_path ${root}/body; proxy_temp_path ${root}/proxy; fastcgi_temp_path ${root}/fastcgi; uwsgi_temp_path ${root}/uwsgi; scgi_temp_path ${root}/scgi;`)
  .replace('server { listen 80 default_server; server_name _; return 444; }','')
  .replaceAll('listen 443 ssl','listen 127.0.0.1:30006 ssl')
  .replaceAll('/etc/nginx/tls/admin/fullchain.pem',cert).replaceAll('/etc/nginx/tls/content/fullchain.pem',cert)
  .replaceAll('/etc/nginx/tls/admin/privkey.pem',key).replaceAll('/etc/nginx/tls/content/privkey.pem',key)
  .replace('http://app:3000','http://127.0.0.1:30007').replace('http://app:8080','http://127.0.0.2:30007');
 fs.writeFileSync(conf,text);execFileSync(binary,['-p',`${root}/`,'-c',conf,'-t'],{stdio:'ignore'});
 const config=loadConfig({ADMIN_PASSWORD:'test-only-admin-password',APP_SECRET:'0123456789abcdef0123456789abcdef',DATA_DIR:path.join(root,'data'),ADMIN_ORIGIN:origin,COOKIE_SECURE:'true',TRUSTED_PROXY_IPS:'127.0.0.1'});
 config.registrationEnabled=true;config.hosting={appDomain:domain,managementOrigin:origin};
 db=openDatabase(':memory:');const messages=[];const apps=await createApps({config,db,accountSender:async m=>messages.push(m)});
 admin=http.createServer(apps.admin);hosted=http.createServer(apps.hosted);await listen(admin,'127.0.0.1');await listen(hosted,'127.0.0.2');
 nginx=spawn(binary,['-p',`${root}/`,'-c',conf,'-g','daemon off;'],{stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){try{ready=(await request('admin.example.org','/api/health')).status===200;if(ready)break;}catch{}if(nginx.exitCode!==null)throw new Error('nginx exited');await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 assert.equal((await post('/api/account/register',{email:'lab@example.org',password:'test-only-password-123'})).status,202);
 for(let i=0;messages.length===0 && i<100;i++)await new Promise(r=>setTimeout(r,20));assert.equal(messages.length,1);
 assert.equal((await post('/api/account/verify',{token:messages[0].token})).status,200);
 const login=await post('/api/account/login',{email:'lab@example.org',password:'test-only-password-123'});assert.equal(login.status,200);const cookie=login.headers['set-cookie'][0].split(';')[0];
 const spaces=await request('admin.example.org','/api/workspaces',{headers:{cookie}});const workspace=JSON.parse(spaces.text)[0].id;
 const boundary='hostlet-lab-boundary',body=`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nProxy lab\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n<h1>Proxy lab content</h1>\r\n--${boundary}--\r\n`;
 const upload=await request('admin.example.org',`/api/workspaces/${workspace}/pages`,{method:'POST',body,headers:{origin,cookie,'content-type':`multipart/form-data; boundary=${boundary}`}});assert.equal(upload.status,201);
 const page=JSON.parse(upload.text).page,host=`${page.id}.apps.exampleusercontent.net`;
 assert.equal((await request(host,'/')).status,401);
 const ticket=await post(`/api/host/${page.id}/tickets`,{},cookie);assert.equal(ticket.status,201);
 const exchange=await request(host,'/__host/exchange',{method:'POST',body:new URLSearchParams({ticket:JSON.parse(ticket.text).ticket}).toString(),headers:{origin,'content-type':'application/x-www-form-urlencoded'}});assert.equal(exchange.status,303);
 const appCookie=exchange.headers['set-cookie'][0].split(';')[0],opened=await request(host,'/',{headers:{cookie:appCookie}});assert.equal(opened.status,200);assert.match(opened.text,/Proxy lab content/);
 const share=await post(`/api/shares/${workspace}/pages/${page.id}`,{password:'share-password'},cookie);assert.equal(share.status,201);const shareData=JSON.parse(share.text).share;
 const visitorTicket=await post('/api/shares/ticket',{pageId:page.id,token:shareData.token,password:'share-password'});assert.equal(visitorTicket.status,201);
 const visitorExchange=await request(host,'/__host/exchange',{method:'POST',body:new URLSearchParams({ticket:JSON.parse(visitorTicket.text).ticket}).toString(),headers:{origin,'content-type':'application/x-www-form-urlencoded'}});assert.equal(visitorExchange.status,303);
 const visitorCookie=visitorExchange.headers['set-cookie'][0].split(';')[0];assert.equal((await request(host,'/',{headers:{cookie:visitorCookie}})).status,200);
 const revoked=await request('admin.example.org',`/api/shares/${workspace}/pages/${page.id}/${shareData.id}`,{method:'DELETE',headers:{origin,cookie}});assert.equal(revoked.status,204);assert.equal((await request(host,'/',{headers:{cookie:visitorCookie}})).status,401);
 console.log('PASS: real application registration, private access and share revocation through isolated Nginx');
} finally {
 if(nginx&&nginx.exitCode===null){const exit=once(nginx,'exit');nginx.kill('SIGTERM');await exit;}
 await Promise.all([close(admin),close(hosted)]);db?.close();await fsp.rm(root,{recursive:true,force:true});
}
