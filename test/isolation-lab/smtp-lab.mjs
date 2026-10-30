// Local-only SMTP protocol lab: synthetic messages and an ephemeral certificate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import nodemailer from 'nodemailer';
import {createMailer} from '../../server/mailer.js';
import {openDatabase} from '../../server/database.js';
import {createAccounts} from '../../server/accounts.js';

const openssl=process.env.HOSTLET_OPENSSL;
if(!openssl || !path.isAbsolute(openssl)) throw new Error('Set HOSTLET_OPENSSL to an absolute OpenSSL path');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-smtp-lab-'));
let secureServer,plainServer,starttlsServer;
try {
 const key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem');
 execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 const certificate=await fs.readFile(cert),privateKey=await fs.readFile(key),messages=[];let authCount=0,rejectRecipient=false;
 const secureContext=tls.createSecureContext({key:privateKey,cert:certificate});
 function serve(socket,{advertiseAuth=true,starttls=false,greeting=true}={}) {
  let buffer='',dataMode=false,lines=[];
  socket.on('error',()=>{});if(greeting)socket.write('220 localhost test SMTP\r\n');
  const receive=chunk=>{
   buffer+=chunk.toString('utf8');let end;
   while((end=buffer.indexOf('\r\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
    if(dataMode){if(line==='.') {messages.push(lines.join('\n'));lines=[];dataMode=false;socket.write('250 queued\r\n');}else lines.push(line);continue;}
    if(/^EHLO /i.test(line)) socket.write(starttls?'250-localhost\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n':advertiseAuth?'250-localhost\r\n250 AUTH PLAIN\r\n':'250 localhost\r\n');
    else if(line==='STARTTLS' && starttls) {
      socket.write('220 ready for TLS\r\n',()=>{socket.removeListener('data',receive);const upgraded=new tls.TLSSocket(socket,{isServer:true,secureContext});serve(upgraded,{greeting:false});});
      return;
    }
    else if(/^AUTH PLAIN /i.test(line)){
      const value=Buffer.from(line.slice('AUTH PLAIN '.length),'base64').toString('utf8');
      if(value==='\0test-user\0test-password'){authCount++;socket.write('235 authenticated\r\n');}else socket.write('535 authentication failed\r\n');
    }
    else if(/^MAIL FROM:/i.test(line))socket.write('250 sender ok\r\n');
    else if(/^RCPT TO:/i.test(line))socket.write(rejectRecipient?'550 recipient refused\r\n':'250 recipient ok\r\n');
    else if(line==='DATA'){dataMode=true;socket.write('354 continue\r\n');}
    else if(line==='QUIT'){socket.end('221 goodbye\r\n');}
    else socket.write('500 unsupported\r\n');
   }
  };socket.on('data',receive);
 }
 secureServer=tls.createServer({key:privateKey,cert:certificate},socket=>serve(socket));
 await new Promise((resolve,reject)=>{secureServer.once('error',reject);secureServer.listen(0,'127.0.0.1',resolve);});
 const config={host:'localhost',port:secureServer.address().port,security:'tls',from:'Hostlet <noreply@example.test>',adminOrigin:'https://admin.example.test',auth:{user:'test-user',pass:'test-password'}};
 const trusted=createMailer(config,{createTransport:options=>nodemailer.createTransport({...options,tls:{...options.tls,ca:certificate}})});
 await trusted({to:'user@example.test',purpose:'verify',token:'a'.repeat(43)});
 await trusted({to:'user@example.test',purpose:'reset',token:'b'.repeat(43)});
 await trusted.sendRetention({to:'user@example.test',pageId:`w-${'a'.repeat(32)}`,workspaceId:'test-space',deleteAfter:Date.parse('2030-01-01T00:00:00Z'),idempotencyKey:'12345678-1234-4123-8123-123456789012'});
 assert.equal(messages.length,3);assert.equal(authCount,3);
 const contents=messages.map(message=>message.replace(/=\n/g,''));
 assert.match(contents[0],/\/verify-email#token=/);assert.match(contents[1],/\/reset-password#token=/);assert.match(contents[2],/\/account/);
 const decodeBody=message=>{
  const [headers,...parts]=message.split('\n\n');const body=parts.join('\n\n');
  if (/content-transfer-encoding:\s*base64/i.test(headers))return Buffer.from(body.replace(/\s/g,''),'base64').toString('utf8');
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers))return Buffer.from(body.replace(/=\n/g,'').replace(/=([0-9a-f]{2})/gi,(_m,hex)=>String.fromCharCode(parseInt(hex,16))),'binary').toString('utf8');
  return body;
 };
 const delivered=messages.map(decodeBody);
 assert.match(delivered[0],/验证邮箱/);assert.match(delivered[1],/重置密码/);assert.match(delivered[2],/inactive application/i);
 assert.match(delivered[0],/verify your email/i);assert.match(delivered[1],/reset your password/i);assert.match(delivered[2],/清理/);
 starttlsServer=net.createServer(socket=>serve(socket,{starttls:true}));
 await new Promise((resolve,reject)=>{starttlsServer.once('error',reject);starttlsServer.listen(0,'127.0.0.1',resolve);});
 const upgraded=createMailer({...config,port:starttlsServer.address().port,security:'starttls'},{createTransport:options=>nodemailer.createTransport({...options,tls:{...options.tls,ca:certificate}})});
 await upgraded({to:'user@example.test',purpose:'verify',token:'f'.repeat(43)});assert.equal(messages.length,4);assert.equal(authCount,4);
 const db=openDatabase(':memory:');
 try {
  const accounts=createAccounts({db,sender:upgraded}),email='account@example.test';
  await accounts.register({email,password:'first test password 123'});
  const verify=messages.at(-1).replace(/=\n/g,'').replace(/=3D/gi,'=').match(/#token=([A-Za-z0-9_-]{43})/);assert.ok(verify);assert.equal(accounts.verifyEmail(verify[1]),true);
  await accounts.requestPasswordReset({email});
  const reset=messages.at(-1).replace(/=\n/g,'').replace(/=3D/gi,'=').match(/#token=([A-Za-z0-9_-]{43})/);assert.ok(reset);
  assert.equal(await accounts.resetPassword({token:reset[1],password:'second test password 456'}),true);
  assert.ok(await accounts.authenticate({email,password:'second test password 456'}));
 } finally {db.close();}
 assert.equal(messages.length,6);assert.equal(authCount,6);
 rejectRecipient=true;await assert.rejects(trusted({to:'user@example.test',purpose:'verify',token:'c'.repeat(43)}));assert.equal(messages.length,6);
 const untrusted=createMailer(config);await assert.rejects(untrusted({to:'user@example.test',purpose:'verify',token:'d'.repeat(43)}));
 plainServer=net.createServer(socket=>serve(socket,{advertiseAuth:false}));
 await new Promise((resolve,reject)=>{plainServer.once('error',reject);plainServer.listen(0,'127.0.0.1',resolve);});
 const requiresUpgrade=createMailer({...config,port:plainServer.address().port,security:'starttls',auth:undefined});
 await assert.rejects(requiresUpgrade({to:'user@example.test',purpose:'verify',token:'e'.repeat(43)}));assert.equal(messages.length,6);
 console.log('PASS: account verification and reset over local SMTP TLS/STARTTLS, authentication, recipient rejection and certificate validation.');
} finally {
 if(secureServer) await new Promise(resolve=>secureServer.close(resolve));
 if(plainServer) await new Promise(resolve=>plainServer.close(resolve));
 if(starttlsServer) await new Promise(resolve=>starttlsServer.close(resolve));
 await fs.rm(root,{recursive:true,force:true});
}
