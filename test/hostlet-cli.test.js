import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import JSZip from 'jszip';

const token='T'.repeat(43), key='request_id_123456789012345';
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-cli-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const mock=path.join(dir,'mock.mjs');
  await fs.writeFile(mock, `import fs from 'node:fs/promises';
globalThis.fetch=async (url,options)=>{
  process.stderr.write('FETCH_STARTED\\n');
  const file=options.body?.get('file');
  const bytes=file ? Buffer.from(await file.arrayBuffer()) : null;
  const method=options.method||'GET';
  await fs.appendFile(process.env.CAPTURE,JSON.stringify({url:String(url),method,headers:options.headers,filename:file?.name,bytes:bytes?.toString('base64')})+'\\n');
  if(process.env.FAIL_FETCH || process.env.FAIL_POST && method==='POST') throw new Error('secret transport error '+process.env.HOSTLET_TOKEN);
  const status=method==='GET' ? process.env.PREFLIGHT_STATUS || process.env.RESPONSE_STATUS || '200' : process.env.RESPONSE_STATUS || '200';
  const body=method==='GET' ? process.env.PREFLIGHT_BODY || process.env.RESPONSE_BODY || '{"status":"not_found"}' : process.env.RESPONSE_BODY || JSON.stringify({page:{id:'page',releaseId:'release'}});
  return new Response(body,{status:Number(status),headers:{'content-type':process.env.CONTENT_TYPE || 'application/json',...(method==='POST' && process.env.REPLAYED ? {'Idempotency-Replayed':process.env.REPLAYED} : {})}});
};`);
  async function run(args,extra={},options={}) {
    const capture=path.join(dir,`capture-${Math.random()}.json`);
    const env={...process.env,HOSTLET_TOKEN:token,CAPTURE:capture,...extra};
    if (options.url === null) delete env.HOSTLET_URL;
    else env.HOSTLET_URL=options.url || 'https://example.test';
    const child=spawn(process.execPath,['--no-warnings','--import',pathToFileURL(mock).href,'cli/hostlet.js',...args],{cwd:process.cwd(),env});
    let stdout='',stderr=''; child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
    const code=await new Promise(resolve=>child.on('close',resolve));
    const requests=await fs.readFile(capture,'utf8').then(s=>s.trim().split('\n').map(JSON.parse),()=>[]);
    const request=requests.at(-1) || null;
    assert.ok(!stdout.includes(token) && !stderr.includes(token));
    return {code,stdout,stderr,request,requests};
  }
  return {dir,run};
}

test('workspaces uses the official Hostlet address when HOSTLET_URL is omitted',async t=>{
  const {run}=await fixture(t);
  const result=await run(['workspaces','--json'],{RESPONSE_BODY:'[]'},{url:null});
  assert.equal(result.code,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),[]);
  assert.equal(result.request.url,'https://hostlet.cn/api/cli/workspaces');
});

test('workspaces honors a custom Hostlet address',async t=>{
  const {run}=await fixture(t);
  const result=await run(['workspaces','--json'],{RESPONSE_BODY:'[]'},{url:'https://hostlet.example.com'});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.url,'https://hostlet.example.com/api/cli/workspaces');
});

test('publish sends a receipt before upload and hashes the exact file bytes',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'index.html');
  const bytes=Buffer.from('<h1>hello</h1>');await fs.writeFile(file,bytes);
  const result=await run(['publish',file,'--workspace','space','--title','Title','--json']);
  assert.equal(result.code,0);assert.equal(JSON.parse(result.stdout).page.id,'page');
  const id=result.request.headers['Idempotency-Key'];assert.match(id,/^[A-Za-z0-9_-]{22,128}$/);
  assert.deepEqual(result.requests.map(r=>r.method),['GET','POST']);
  assert.equal(result.requests[0].url,`https://example.test/api/cli/workspaces/space/publications/${id}`);
  assert.equal(result.requests[0].headers.Authorization,`Bearer ${token}`);
  assert.ok(result.stderr.indexOf(id)>=0 && result.stderr.indexOf(id)<result.stderr.indexOf('FETCH_STARTED'));
  assert.equal(result.request.headers['X-Content-SHA256'],createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.request.headers['X-Content-Length'],String(bytes.length));
  assert.deepEqual(Buffer.from(result.request.bytes,'base64'),bytes);
});

test('directory archives are reproducible despite creation order and mtimes',async t=>{
  const {dir,run}=await fixture(t), a=path.join(dir,'a'), b=path.join(dir,'b');
  for (const d of [a,b]) await fs.mkdir(path.join(d,'nested'),{recursive:true});
  await fs.writeFile(path.join(a,'index.html'),'hello');await fs.writeFile(path.join(a,'nested','x.txt'),'world');
  await fs.writeFile(path.join(b,'nested','x.txt'),'world');await fs.writeFile(path.join(b,'index.html'),'hello');
  await fs.utimes(path.join(b,'index.html'),new Date('2022-01-01'),new Date('2022-01-01'));
  const args=d=>['publish',d,'--workspace','space','--title','Title','--request-id',key,'--json'];
  const first=await run(args(a)), second=await run(args(b));
  assert.equal(first.code,0);assert.equal(second.code,0);
  assert.equal(first.request.headers['Idempotency-Key'],key);
  assert.equal(first.request.bytes,second.request.bytes);
  const bytes=Buffer.from(first.request.bytes,'base64');
  assert.equal(first.request.headers['X-Content-SHA256'],createHash('sha256').update(bytes).digest('hex'));
  assert.equal(first.request.headers['X-Content-Length'],String(bytes.length));
  const zip=await JSZip.loadAsync(bytes);assert.equal(await zip.file('nested/x.txt').async('string'),'world');
});

test('status handles all statuses including JSON not_found on HTTP 404',async t=>{
  const {run}=await fixture(t);
  for(const status of ['not_found','in_progress','interrupted','succeeded']) {
    const data={status,...(status==='succeeded'?{result:{page:{id:'p'}}}:{})};
    const result=await run(['publish-status','--workspace','space /','--request-id',key,'--json'],{RESPONSE_STATUS:status==='not_found'?'404':'200',RESPONSE_BODY:JSON.stringify(data)});
    assert.equal(result.code,0);assert.deepEqual(JSON.parse(result.stdout),data);
    assert.equal(result.request.url,`https://example.test/api/cli/workspaces/space%20%2F/publications/${key}`);
    assert.equal(result.request.method,'GET');
  }
});

test('invalid IDs are rejected and network failures give safe recovery instructions',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'index.html');await fs.writeFile(file,'hello');
  for(const id of ['short','x'.repeat(129),'x'.repeat(21)+'!','x'.repeat(22)+'\n']) {
    const bad=await run(['publish',file,'--workspace','space','--title','Title','--request-id',id]);
    assert.notEqual(bad.code,0);assert.equal(bad.request,null);
  }
  const failed=await run(['publish',file,'--workspace','space','--title','Title','--request-id',key,'--json'],{FAIL_POST:'1'});
  assert.notEqual(failed.code,0);assert.equal(failed.stdout,'');assert.match(failed.stderr,/publish-status/);assert.match(failed.stderr,/retry/i);assert.match(failed.stderr,new RegExp(key));
});

test('replacement sends the original ZIP bytes and preserves its target',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'site.zip');
  const bytes=Buffer.from([0,1,2,3,255]);await fs.writeFile(file,bytes);
  const result=await run(['publish',file,'--workspace','team','--page','page 1','--revision','7','--request-id',key,'--json']);
  assert.equal(result.code,0);assert.match(result.request.url,/\/pages\/page%201\/replace$/);
  assert.equal(result.request.filename,'site.zip');assert.deepEqual(Buffer.from(result.request.bytes,'base64'),bytes);
  assert.equal(result.request.headers['X-Content-SHA256'],createHash('sha256').update(bytes).digest('hex'));
});

test('unexpected status and publish responses do not report success',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'index.html');await fs.writeFile(file,'hello');
  const status=await run(['publish-status','--workspace','space','--request-id',key,'--json'],{RESPONSE_STATUS:'404',RESPONSE_BODY:'{"error":"missing endpoint"}'});
  assert.notEqual(status.code,0);assert.equal(status.stdout,'');
  const publish=await run(['publish',file,'--workspace','space','--title','Title','--request-id',key,'--json'],{PREFLIGHT_BODY:'{"status":"not_found"}',RESPONSE_BODY:'{}'});
  assert.notEqual(publish.code,0);assert.equal(publish.stdout,'');assert.match(publish.stderr,/result unknown/i);
});

test('preflight refuses old servers, denied access, malformed responses and network errors before POST',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'index.html');await fs.writeFile(file,'hello');
  const args=['publish',file,'--workspace','space','--title','Title','--request-id',key,'--json'];
  for (const env of [
    {PREFLIGHT_STATUS:'404',PREFLIGHT_BODY:'{"error":"not found"}'},
    {PREFLIGHT_STATUS:'404',PREFLIGHT_BODY:'<html>not found</html>',CONTENT_TYPE:'text/html'},
    {PREFLIGHT_STATUS:'401',PREFLIGHT_BODY:'{"status":"not_found"}'},
    {PREFLIGHT_STATUS:'403',PREFLIGHT_BODY:'{"status":"not_found"}'},
    {PREFLIGHT_STATUS:'500',PREFLIGHT_BODY:'{"status":"not_found"}'},
    {PREFLIGHT_STATUS:'404',PREFLIGHT_BODY:'{"status":"succeeded"}'},
    {PREFLIGHT_STATUS:'200',PREFLIGHT_BODY:'{"status":"unexpected"}'},
    {PREFLIGHT_STATUS:'200',PREFLIGHT_BODY:'{"status":"not_found"}',CONTENT_TYPE:'text/html'},
    {FAIL_FETCH:'1'}
  ]) {
    const result=await run(args,env);
    assert.notEqual(result.code,0,JSON.stringify(env));assert.deepEqual(result.requests.map(r=>r.method),['GET']);
    assert.equal(result.stdout,'');assert.match(result.stderr,/preflight/i);
    assert.match(result.request.url,new RegExp(`/publications/${key}$`));
  }
});

test('preflight accepts known statuses but never treats succeeded as the current payload success',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'index.html');await fs.writeFile(file,'hello');
  const args=['publish',file,'--workspace','space','--title','Title','--request-id',key,'--json'];
  for (const [status,http] of [['not_found','404'],['not_found','200'],['interrupted','200'],['in_progress','200'],['succeeded','200']]) {
    const result=await run(args,{PREFLIGHT_STATUS:http,PREFLIGHT_BODY:JSON.stringify({status,result:{page:{id:'previous'}}})});
    assert.equal(result.code,0,`${status} ${result.stderr}`);
    assert.deepEqual(result.requests.map(r=>r.method),['GET','POST']);
    assert.equal(result.requests[1].headers['Idempotency-Key'],key);
    assert.equal(JSON.parse(result.stdout).page.id,'page');
  }
});

test('status labels historical results and reports current page state conservatively',async t=>{
  const {run}=await fixture(t);
  for (const current of ['unchanged','updated','deleted','unexpected',undefined]) {
    const data={status:'succeeded',result:{page:{id:'old-page',releaseId:'old-release'}},...(current===undefined?{}:{current})};
    const env={RESPONSE_BODY:JSON.stringify(data)};
    const human=await run(['publish-status','--workspace','space','--request-id',key],env);
    assert.equal(human.code,0);assert.match(human.stdout,/historical/i);assert.match(human.stdout,/old-page/);
    assert.match(human.stdout,/current page state/i);
    assert.match(human.stdout,['unchanged','updated','deleted'].includes(current) ? new RegExp(`current page state: ${current}`,'i') : /current page state: unknown/i);
    const json=await run(['publish-status','--workspace','space','--request-id',key,'--json'],env);
    assert.deepEqual(JSON.parse(json.stdout),data);
  }
});

test('successful replay confirms the original request and directs users to current state',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'index.html');await fs.writeFile(file,'hello');
  const args=['publish',file,'--workspace','space','--title','Title','--request-id',key];
  for (const current of ['unchanged','updated','deleted',undefined]) {
    const env={PREFLIGHT_BODY:JSON.stringify({status:'succeeded',...(current===undefined?{}:{current})})};
    const result=await run(args,env);
    assert.equal(result.code,0);assert.match(result.stdout,/original publication request.*confirmed/i);
    assert.match(result.stdout,/current page state/i);assert.match(result.stdout,/manage/i);
    assert.doesNotMatch(result.stdout,/published private application/i);
    const json=await run([...args,'--json'],env);
    assert.equal(JSON.parse(json.stdout).page.id,'page');
    assert.match(json.stderr,/original publication request.*confirmed/i);assert.match(json.stderr,/current page state/i);
  }
  const first=await run(args,{PREFLIGHT_BODY:'{"status":"not_found"}'});
  assert.match(first.stdout,/published private application/i);
});

test('replay response header wins over preflight and first publish remains identifiable',async t=>{
  const {dir,run}=await fixture(t), file=path.join(dir,'index.html');await fs.writeFile(file,'hello');
  const args=['publish',file,'--workspace','space','--title','Title','--request-id',key];
  for (const status of ['not_found','in_progress']) {
    const env={PREFLIGHT_BODY:JSON.stringify({status}),REPLAYED:'true'};
    const human=await run(args,env);
    assert.equal(human.code,0);assert.match(human.stdout,/original publication request.*confirmed/i);
    assert.doesNotMatch(human.stdout,/published private application/i);
    const json=await run([...args,'--json'],env);
    assert.equal(JSON.parse(json.stdout).page.id,'page');assert.match(json.stderr,/current page state/i);
  }
  const first=await run(args,{PREFLIGHT_BODY:'{"status":"not_found"}',REPLAYED:'false'});
  assert.match(first.stdout,/published private application/i);
  const previous=await run(args,{PREFLIGHT_BODY:'{"status":"succeeded"}',REPLAYED:'false'});
  assert.match(previous.stdout,/original publication request.*confirmed/i);
});
