#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import JSZip from 'jszip';

const {version}=createRequire(import.meta.url)('./package.json');
const commands=new Map([
  ['workspaces',{
    summary:'List workspaces available to the credential.',
    usage:'hostlet workspaces [--json]',
    options:[['--json','Print machine-readable JSON.']],
    notes:['Requires the read scope. Plain output is tab-separated: id, name, role.']
  }],
  ['pages',{
    summary:'List applications in a workspace.',
    usage:'hostlet pages --workspace <id> [--json]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:['Requires the read scope.']
  }],
  ['versions',{
    summary:'List retained releases of an application.',
    usage:'hostlet versions --workspace <id> --page <id> [--json]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--page <id>','Application ID.'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:['Requires the read scope. The active release is marked "current".']
  }],
  ['publish',{
    summary:'Publish a new application or replace an existing release.',
    usage:'hostlet publish <html|zip|directory> --workspace <id> --title <title> [options]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--title <title>','Title for a new application. Required unless --page is supplied.'],
      ['--entry <path>','HTML entry file inside a ZIP or directory archive.'],
      ['--page <id>','Existing application to replace.'],
      ['--revision <n>','Current revision of --page; required together with --page.'],
      ['--request-id <id>','Idempotency key: 22-128 letters, digits, "_" or "-".'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:[
      'Requires the publish scope. New applications are private; this command never publishes an application publicly.',
      'The request ID is written to stderr before upload. After a network error or an unconfirmed response, run publish-status before retrying with the same request ID and unchanged content.',
      'Directories must not contain hidden files, node_modules or symbolic links.'
    ]
  }],
  ['publish-status',{
    summary:'Check an earlier publication request.',
    usage:'hostlet publish-status --workspace <id> --request-id <id> [--json]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--request-id <id>','Request ID printed by publish.'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:['Requires the read or publish scope. Statuses: not_found, in_progress, interrupted, succeeded. A succeeded result is historical; check the application for its current state.']
  }],
  ['rollback',{
    summary:'Activate a retained release as the current version.',
    usage:'hostlet rollback --workspace <id> --page <id> --release <id> --revision <n> [--json]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--page <id>','Application ID.'],
      ['--release <id>','Release ID to activate.'],
      ['--revision <n>','Current application revision.'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:['Requires the publish scope. On CONFLICT, re-read the application and retry with its latest revision.']
  }],
  ['shares',{
    summary:'List share links for an application.',
    usage:'hostlet shares --workspace <id> --page <id> [--json]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--page <id>','Application ID.'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:['Requires the share scope. Only share metadata is listed; share tokens are never printed.']
  }],
  ['share',{
    summary:'Create a share link for a private application.',
    usage:'hostlet share --workspace <id> --page <id> [--expires <iso>] [--password-stdin] [--json]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--page <id>','Application ID.'],
      ['--expires <iso>','Future ISO-8601 expiry time, for example 2027-01-01T00:00:00Z.'],
      ['--password-stdin','Read the share password from standard input.'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:[
      'Requires the share scope. The link is shown once and cannot be recovered.',
      'The password can also be supplied through HOSTLET_SHARE_PASSWORD. Do not use both methods.',
      'After a network error or 5xx response, run shares before retrying.'
    ]
  }],
  ['revoke-share',{
    summary:'Revoke a share link immediately.',
    usage:'hostlet revoke-share --workspace <id> --page <id> --share <id> [--json]',
    options:[
      ['--workspace <id>','Workspace ID.'],
      ['--page <id>','Application ID.'],
      ['--share <id>','Share ID.'],
      ['--json','Print machine-readable JSON.']
    ],
    notes:['Requires the share scope. Revocation takes effect immediately.']
  }]
]);
const usage=['Usage:',...[...commands.values()].map(command=>`  ${command.usage}`)].join('\n');
const helpHint='Run "hostlet help <command>" for details.';
const usageError=()=>new Error(`${usage}\n${helpHint}`);
function wrapText(text,width=96) {
  const lines=[];let line='';
  for (const word of text.split(/\s+/)) {
    if (!line) line=word;
    else if (line.length+word.length+1<=width) line+=` ${word}`;
    else {lines.push(line);line=word;}
  }
  if (line) lines.push(line);
  return lines;
}
function commandHelp(name) {
  const command=commands.get(name);
  const lines=[command.summary,'','Usage:',`  ${command.usage}`,'','Options:'];
  const width=Math.max(...command.options.map(([flag])=>flag.length));
  for (const [flag,description] of command.options) lines.push(`  ${flag.padEnd(width)}  ${description}`);
  if (command.notes.length) {
    lines.push('','Notes:');
    for (const note of command.notes) {
      wrapText(note).forEach((line,index)=>lines.push(`${index ? '    ' : '  - '}${line}`));
    }
  }
  return lines.join('\n');
}
function generalHelp() {
  const width=Math.max(...[...commands.keys()].map(name=>name.length));
  const lines=[
    `Hostlet CLI ${version}`,
    '',
    'Publish and manage static applications hosted on a Hostlet instance.',
    '',
    'Usage:',
    '  hostlet <command> [options]',
    '  hostlet help <command>',
    '  hostlet --version',
    '',
    'Commands:'
  ];
  for (const [name,command] of commands) lines.push(`  ${name.padEnd(width)}  ${command.summary}`);
  lines.push(
    '',
    'Environment:',
    '  HOSTLET_URL             Management origin, for example https://hostlet.example.com',
    '  HOSTLET_TOKEN           43-character API credential. Never pass it on the command line.',
    '  HOSTLET_SHARE_PASSWORD  Optional share password; prefer --password-stdin.',
    '',
    'Global options:',
    '  -h, --help     Show help. Use "hostlet help <command>" for command details.',
    '  -v, --version  Print the CLI version.',
    '',
    'Remote instances must use HTTPS. HTTP is accepted only for localhost, 127.0.0.1 and [::1].'
  );
  return lines.join('\n');
}
const validRequestId=id=>typeof id==='string' && id.length>=22 && id.length<=128 && !/[^A-Za-z0-9_-]/.test(id);
const validRevision=value=>typeof value==='string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value));
const redact=value=>process.env.HOSTLET_TOKEN ? String(value).replaceAll(process.env.HOSTLET_TOKEN,'[redacted]') : String(value);
const output=value=>process.stdout.write(redact(value));
const outputError=value=>process.stderr.write(redact(value));
function options(args,allowed) {
  const result={};
  for (let i=0;i<args.length;i++) {
    const key=args[i];
    if (!allowed.includes(key) || Object.hasOwn(result,key)) throw usageError();
    if (key==='--json' || key==='--password-stdin') result[key]=true;
    else { if (!args[i+1] || args[i+1].startsWith('--')) throw usageError(); result[key]=args[++i]; }
  }
  return result;
}
async function apiJson(base,token,pathname,{method='GET',body,action}={}) {
  let response;
  try {
    response=await fetch(new URL(pathname,base),{
      method,
      headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      redirect:'error'
    });
  } catch {
    const error=new Error(`${action} network error.`);
    error.code='NETWORK';
    throw error;
  }
  if (response.status===204) return null;
  const type=response.headers.get('content-type') || '';
  let data=null;
  if (/^application\/json(?:\s*;|\s*$)/i.test(type)) {
    try {data=await response.json();}
    catch {
      const error=new Error(`${action} returned invalid JSON (HTTP ${response.status}).`);
      error.code='INVALID_RESPONSE';
      error.status=response.status;
      throw error;
    }
  }
  if (!response.ok) {
    const code=typeof data?.code==='string' ? data.code : `HTTP_${response.status}`;
    const detail=typeof data?.code==='string' ? `: ${code}` : '';
    const hint=response.status===401 || response.status===403
      ? ' Check HOSTLET_TOKEN and its scopes.'
      : response.status===409 ? ' Refresh the current state and retry with the latest revision.' : '';
    const error=new Error(`${action} failed (HTTP ${response.status})${detail}.${hint}`);
    error.code=code;
    error.status=response.status;
    throw error;
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(type) || !data || typeof data!=='object') {
    const error=new Error(`${action} returned an invalid response (HTTP ${response.status}).`);
    error.code='INVALID_RESPONSE';
    error.status=response.status;
    throw error;
  }
  return data;
}
async function readStdinPassword() {
  let value='';
  for await (const chunk of process.stdin) value+=chunk;
  value=value.replace(/\r?\n$/,'');
  if (!value || Buffer.byteLength(value)>1024) throw new Error('Password from stdin must contain 1-1024 bytes.');
  return value;
}
function parseExpiry(value) {
  const at=Date.parse(value);
  if (!Number.isSafeInteger(at) || at<=Date.now()) throw new Error('--expires must be a future ISO-8601 date and time.');
  return at;
}
const shareStatus=share=>share.revokedAt!==null && share.revokedAt!==undefined ? 'revoked' : Number.isSafeInteger(share.expiresAt) && share.expiresAt<=Date.now() ? 'expired' : 'active';
const formatTime=value=>Number.isSafeInteger(value) ? new Date(value).toISOString() : 'never';
async function archiveDirectory(root) {
  const zip=new JSZip(); let count=0,entries=0,bytes=0;
  async function walk(dir,relative='') {
    const children=await fs.readdir(dir,{withFileTypes:true});
    children.sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of children) {
      if (++entries>4000) throw new Error('Directory exceeds archive entry limits.');
      if (entry.name.startsWith('.') || entry.name==='node_modules') throw new Error(`Remove hidden files and node_modules from the publish directory: ${entry.name}`);
      const name=relative ? `${relative}/${entry.name}` : entry.name;
      const file=path.join(dir,entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${name}`);
      if (entry.isDirectory()) await walk(file,name);
      else if (entry.isFile()) {
        const stat=await fs.stat(file);bytes+=stat.size;
        if (++count>2000 || stat.size>25*1024*1024 || bytes>100*1024*1024) throw new Error('Directory exceeds archive limits.');
        zip.file(name,await fs.readFile(file),{date:new Date(1980,0,1),unixPermissions:0o100644,createFolders:false});
      } else throw new Error(`Unsupported file type: ${name}`);
    }
  }
  await walk(root);
  if (!count) throw new Error('Directory is empty.');
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',platform:'UNIX'});
}
async function publicationStatus(base,token,workspace,requestId) {
  const url=new URL(`/api/cli/workspaces/${encodeURIComponent(workspace)}/publications/${encodeURIComponent(requestId)}`,base);
  let response;
  try {response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});}
  catch {throw new Error('Status lookup network error.');}
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')) throw new Error(`Status lookup returned a non-JSON response (HTTP ${response.status}).`);
  let result;try {result=await response.json();} catch {throw new Error(`Status lookup returned invalid JSON (HTTP ${response.status}).`);}
  if (!(response.status===200 || response.status===404 && result?.status==='not_found')) throw new Error(`Status lookup failed (HTTP ${response.status}).`);
  if (!result || typeof result!=='object' || Array.isArray(result) || !['not_found','in_progress','interrupted','succeeded'].includes(result.status)) throw new Error('Invalid status response.');
  return result;
}
async function main() {
  const [command,...rest]=process.argv.slice(2);
  if (!command) {
    outputError(`${generalHelp()}\n\nNo command supplied. Run "hostlet --help" for the command list.\n`);
    process.exitCode=1;
    return;
  }
  if (command==='--help' || command==='-h') {output(`${generalHelp()}\n`);return;}
  if (command==='--version' || command==='-v' || command==='-V') {output(`hostlet-cli ${version}\n`);return;}
  if (command==='help') {
    if (rest.length===0 || rest.length===1 && (rest[0]==='--help' || rest[0]==='-h')) {output(`${generalHelp()}\n`);return;}
    if (rest.length!==1) {outputError('hostlet: help accepts a single command name.\n');process.exitCode=1;return;}
    if (!commands.has(rest[0])) {
      outputError(`hostlet: unknown command "${rest[0]}".\nRun "hostlet --help" for the command list.\n`);
      process.exitCode=1;
      return;
    }
    output(`${commandHelp(rest[0])}\n`);
    return;
  }
  if (!commands.has(command)) {
    outputError(`hostlet: unknown command "${command}".\nRun "hostlet --help" for the command list.\n`);
    process.exitCode=1;
    return;
  }
  if (rest.includes('--help') || rest.includes('-h')) {output(`${commandHelp(command)}\n`);return;}
  const token=process.env.HOSTLET_TOKEN, raw=process.env.HOSTLET_URL;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '') || !raw) throw new Error(`${usage}\nSet HOSTLET_URL and HOSTLET_TOKEN. ${helpHint}`);
  const base=new URL(raw);
  if (base.username || base.password || base.pathname!=='/' || base.search || base.hash || !(base.protocol==='https:' || base.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))) throw new Error('HOSTLET_URL must be an HTTPS origin (HTTP is allowed only for loopback testing).');
  if (command==='workspaces' && (rest.length===0 || rest.length===1 && rest[0]==='--json')) {
    const response=await fetch(new URL('/api/cli/workspaces',base),{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
    if (!response.ok) throw new Error(`Workspace lookup failed (HTTP ${response.status}).`);
    const data=await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid workspace response.');
    output(rest[0]==='--json' ? `${JSON.stringify(data)}\n` : data.map(item=>`${item.id}\t${item.name}\t${item.role}`).join('\n')+'\n');
    return;
  }
  if (command==='pages' || command==='versions') {
    const opts=options(rest,['--workspace','--page','--json']);
    if (!opts['--workspace'] || (command==='versions' && !opts['--page']) || Object.keys(opts).some(key=>!['--workspace','--page','--json'].includes(key)) || (command==='pages' && opts['--page'])) throw usageError();
    const suffix=command==='versions' ? `/${encodeURIComponent(opts['--page'])}/releases` : '';
    const response=await fetch(new URL(`/api/cli/workspaces/${encodeURIComponent(opts['--workspace'])}/pages${suffix}`,base),{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
    if (!response.ok) throw new Error(`Listing failed (HTTP ${response.status}).`);
    const result=await response.json(), items=command==='versions' ? result.releases : result.pages;
    if (!Array.isArray(items)) throw new Error('Invalid listing response.');
    const lines=items.map(item=>command==='versions' ? `${item.releaseId}\t${item.current ? 'current' : 'previous'}\t${item.entryFile}` : `${item.id}\t${item.title}\trevision ${item.revision}`);
    output(opts['--json'] ? `${JSON.stringify(result)}\n` : (lines.length ? `${lines.join('\n')}\n` : 'No results.\n'));
    return;
  }
  if (command==='publish-status') {
    const opts=options(rest,['--workspace','--request-id','--json']);
    if (!opts['--workspace'] || !validRequestId(opts['--request-id']) || Object.keys(opts).some(key=>!['--workspace','--request-id','--json'].includes(key))) throw usageError();
    const result=await publicationStatus(base,token,opts['--workspace'],opts['--request-id']);
    const current=['unchanged','updated','deleted'].includes(result.current) ? result.current : 'unknown';
    const details=result.status==='succeeded' ? `\nHistorical publication result: ${JSON.stringify(result.result ?? null)}\nCurrent page state: ${current}. Check the page or management view for its current state.` : result.result ? `\n${JSON.stringify(result.result)}` : '';
    output(opts['--json'] ? `${JSON.stringify(result)}\n` : `Publication status: ${result.status}${details}\n`);
    return;
  }
  if (command==='rollback') {
    const opts=options(rest,['--workspace','--page','--release','--revision','--json']);
    if (!opts['--workspace'] || !opts['--page'] || !opts['--release'] || !validRevision(opts['--revision'])) throw usageError();
    const result=await apiJson(base,token,`/api/cli/workspaces/${encodeURIComponent(opts['--workspace'])}/pages/${encodeURIComponent(opts['--page'])}/releases/${encodeURIComponent(opts['--release'])}/activate`,{
      method:'POST',body:{revision:Number(opts['--revision'])},action:'Rollback'
    });
    if (!result?.page?.id || !result.page.releaseId || !Number.isSafeInteger(result.page.revision)) throw new Error('Rollback returned an invalid response; refresh the page before retrying.');
    output(opts['--json'] ? `${JSON.stringify(result)}\n` : `Activated application ${result.page.id} at release ${result.page.releaseId} (revision ${result.page.revision}).\n`);
    return;
  }
  if (command==='shares') {
    const opts=options(rest,['--workspace','--page','--json']);
    if (!opts['--workspace'] || !opts['--page']) throw usageError();
    const result=await apiJson(base,token,`/api/cli/workspaces/${encodeURIComponent(opts['--workspace'])}/pages/${encodeURIComponent(opts['--page'])}/shares`,{action:'Share listing'});
    if (!Array.isArray(result?.shares)) throw new Error('Share listing returned an invalid response.');
    const lines=result.shares.map(share=>`${share.id}\t${shareStatus(share)}\t${share.passwordProtected ? 'password' : 'no-password'}\texpires=${formatTime(share.expiresAt)}\tcreated=${formatTime(share.createdAt)}`);
    output(opts['--json'] ? `${JSON.stringify(result)}\n` : (lines.length ? `${lines.join('\n')}\n` : 'No shares.\n'));
    return;
  }
  if (command==='share') {
    const opts=options(rest,['--workspace','--page','--expires','--password-stdin','--json']);
    if (!opts['--workspace'] || !opts['--page']) throw usageError();
    if (opts['--password-stdin'] && process.env.HOSTLET_SHARE_PASSWORD !== undefined) throw new Error('Use either --password-stdin or HOSTLET_SHARE_PASSWORD, not both.');
    const password=opts['--password-stdin'] ? await readStdinPassword() : process.env.HOSTLET_SHARE_PASSWORD;
    if (password !== undefined && (!password || Buffer.byteLength(password)>1024)) throw new Error('Share password must contain 1-1024 bytes.');
    const body={};
    if (password !== undefined) body.password=password;
    if (opts['--expires']) body.expiresAt=parseExpiry(opts['--expires']);
    let result;
    try {
      result=await apiJson(base,token,`/api/cli/workspaces/${encodeURIComponent(opts['--workspace'])}/pages/${encodeURIComponent(opts['--page'])}/shares`,{method:'POST',body,action:'Share creation'});
    } catch (error) {
      if (!error.status || error.status>=500 || ['NETWORK','INVALID_RESPONSE'].includes(error.code)) throw new Error(`Share creation result unknown. Check existing shares before retrying; a created share link cannot be recovered. ${error.message}`);
      throw error;
    }
    if (typeof result?.share?.id!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(result.share.token || '')) throw new Error('Share creation returned an invalid response. Check existing shares before retrying; a created share link cannot be recovered.');
    const shareUrl=new URL('/share',base);
    shareUrl.hash=new URLSearchParams({page:opts['--page'],token:result.share.token}).toString();
    const payload={share:result.share,shareUrl:shareUrl.href};
    output(opts['--json'] ? `${JSON.stringify(payload)}\n` : `Created share ${result.share.id} for application ${opts['--page']}.\nShare link: ${shareUrl.href}\nThis link cannot be retrieved again.\n`);
    return;
  }
  if (command==='revoke-share') {
    const opts=options(rest,['--workspace','--page','--share','--json']);
    if (!opts['--workspace'] || !opts['--page'] || !opts['--share']) throw usageError();
    await apiJson(base,token,`/api/cli/workspaces/${encodeURIComponent(opts['--workspace'])}/pages/${encodeURIComponent(opts['--page'])}/shares/${encodeURIComponent(opts['--share'])}`,{method:'DELETE',action:'Share revocation'});
    output(opts['--json'] ? `${JSON.stringify({revoked:true,shareId:opts['--share']})}\n` : `Revoked share ${opts['--share']}.\n`);
    return;
  }
  const [input,...args]=rest;
  if (command!=='publish' || !input) throw usageError();
  const opts=options(args,['--workspace','--title','--entry','--page','--revision','--request-id','--json']);
  if (!opts['--workspace'] || (!opts['--page'] && !opts['--title'])) throw usageError();
  if (opts['--request-id'] && !validRequestId(opts['--request-id'])) throw new Error('Request ID must contain 22-128 base64url characters.');
  if (Boolean(opts['--page']) !== Boolean(opts['--revision']) || opts['--revision'] && !validRevision(opts['--revision'])) throw new Error('Replacement requires --page and --revision.');
  const stat=await fs.lstat(input);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported.');
  let filename=path.basename(input), data;
  if (stat.isDirectory()) { data=await archiveDirectory(input); filename='site.zip'; }
  else if (stat.isFile() && /\.(?:html?|zip)$/i.test(filename) && stat.size<=100*1024*1024) data=await fs.readFile(input);
  else throw new Error('Choose a supported HTML file, ZIP, or directory within the upload limit.');
  const form=new FormData();form.set('file',new Blob([data]),filename);
  if (opts['--page']) form.set('revision',opts['--revision']); else form.set('title',opts['--title']);
  if (opts['--entry']) form.set('entryFile',opts['--entry']);
  const pagePath=opts['--page'] ? `/${encodeURIComponent(opts['--page'])}/replace` : '';
  const url=new URL(`/api/cli/workspaces/${encodeURIComponent(opts['--workspace'])}/pages${pagePath}`,base);
  const requestId=opts['--request-id'] || randomBytes(24).toString('base64url');
  const recovery=`Check publish-status --workspace ${opts['--workspace']} --request-id ${requestId}; retry the same publication with --request-id ${requestId} and unchanged content and options.`;
  outputError(`Publication request ID: ${requestId}\n`);
  let preflight;
  try {preflight=await publicationStatus(base,token,opts['--workspace'],requestId);}
  catch (error) {throw new Error(`Publish preflight failed; no upload was sent. ${error.message} Verify server support and authorization, then retry with the same request ID: ${requestId}.`);}
  let response;
  try {response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':requestId,'X-Content-SHA256':createHash('sha256').update(data).digest('hex'),'X-Content-Length':String(data.length)},body:form,redirect:'error'});}
  catch {throw new Error(`Publish result unknown due to a network error. ${recovery}`);}
  let body;try {body=await response.json();} catch {throw new Error(`Publish result unknown (HTTP ${response.status}; invalid response). ${recovery}`);}
  if (!response.ok) throw new Error(`Publish was not confirmed (HTTP ${response.status}). ${recovery}`);
  if (!body?.page?.id || !body.page.releaseId) throw new Error(`Publish result unknown (invalid response). ${recovery}`);
  const result={page:body.page,managementUrl:new URL('/account',base).href};
  const replayed=preflight.status==='succeeded' || response.headers.get('Idempotency-Replayed')==='true';
  const message=replayed ? `Original publication request confirmed. For the current page state, check the page or open the management view at ${result.managementUrl}.` : `Published private application ${body.page.id} (version ${body.page.releaseId}). Manage it at ${result.managementUrl}`;
  if (opts['--json'] && replayed) outputError(`${message}\n`);
  output(opts['--json'] ? `${JSON.stringify(result)}\n` : `${message}\n`);
}
main().catch(error=>{outputError(`${error.message}\n`);process.exitCode=1;});
