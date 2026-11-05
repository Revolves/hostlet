#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import JSZip from 'jszip';

const usage='Usage: hostlet workspaces [--json]\n       hostlet pages --workspace <id> [--json]\n       hostlet versions --workspace <id> --page <id> [--json]\n       hostlet publish <html|zip|directory> --workspace <id> --title <title> [--entry <path>] [--page <id> --revision <n>] [--request-id <id>] [--json]\n       hostlet publish-status --workspace <id> --request-id <id> [--json]';
const validRequestId=id=>typeof id==='string' && id.length>=22 && id.length<=128 && !/[^A-Za-z0-9_-]/.test(id);
const redact=value=>process.env.HOSTLET_TOKEN ? String(value).replaceAll(process.env.HOSTLET_TOKEN,'[redacted]') : String(value);
const output=value=>process.stdout.write(redact(value));
function options(args) {
  const result={};
  for (let i=0;i<args.length;i++) {
    const key=args[i];
    if (!['--workspace','--title','--entry','--page','--revision','--request-id','--json'].includes(key) || Object.hasOwn(result,key)) throw new Error(usage);
    if (key==='--json') result[key]=true;
    else { if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(usage); result[key]=args[++i]; }
  }
  return result;
}
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
  const token=process.env.HOSTLET_TOKEN, raw=process.env.HOSTLET_URL;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '') || !raw) throw new Error(`${usage}\nSet HOSTLET_URL and HOSTLET_TOKEN.`);
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
    const opts=options(rest);
    if (!opts['--workspace'] || (command==='versions' && !opts['--page']) || Object.keys(opts).some(key=>!['--workspace','--page','--json'].includes(key)) || (command==='pages' && opts['--page'])) throw new Error(usage);
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
    const opts=options(rest);
    if (!opts['--workspace'] || !validRequestId(opts['--request-id']) || Object.keys(opts).some(key=>!['--workspace','--request-id','--json'].includes(key))) throw new Error(usage);
    const result=await publicationStatus(base,token,opts['--workspace'],opts['--request-id']);
    const current=['unchanged','updated','deleted'].includes(result.current) ? result.current : 'unknown';
    const details=result.status==='succeeded' ? `\nHistorical publication result: ${JSON.stringify(result.result ?? null)}\nCurrent page state: ${current}. Check the page or management view for its current state.` : result.result ? `\n${JSON.stringify(result.result)}` : '';
    output(opts['--json'] ? `${JSON.stringify(result)}\n` : `Publication status: ${result.status}${details}\n`);
    return;
  }
  const [input,...args]=rest;
  if (command!=='publish' || !input) throw new Error(usage);
  const opts=options(args);
  if (!opts['--workspace'] || (!opts['--page'] && !opts['--title'])) throw new Error(usage);
  if (opts['--request-id'] && !validRequestId(opts['--request-id'])) throw new Error('Request ID must contain 22-128 base64url characters.');
  if (Boolean(opts['--page']) !== Boolean(opts['--revision']) || opts['--revision'] && !/^(0|[1-9]\d*)$/.test(opts['--revision'])) throw new Error('Replacement requires --page and --revision.');
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
  process.stderr.write(redact(`Publication request ID: ${requestId}\n`));
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
  if (opts['--json'] && replayed) process.stderr.write(redact(`${message}\n`));
  output(opts['--json'] ? `${JSON.stringify(result)}\n` : `${message}\n`);
}
main().catch(error=>{process.stderr.write(redact(`${error.message}\n`));process.exitCode=1;});
