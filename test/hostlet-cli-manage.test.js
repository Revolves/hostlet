import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const token='T'.repeat(43);
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-cli-manage-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const mock=path.join(dir,'mock.mjs');
  await fs.writeFile(mock, `import fs from 'node:fs/promises';
globalThis.fetch=async (url,options={})=>{
  const method=options.method||'GET';
  let json=null;
  if (typeof options.body==='string') { try { json=JSON.parse(options.body); } catch {} }
  await fs.appendFile(process.env.CAPTURE,JSON.stringify({url:String(url),method,headers:options.headers,json})+'\\n');
  const status=Number(process.env.RESPONSE_STATUS || (method==='DELETE' ? '204' : '200'));
  return new Response(status===204 ? null : process.env.RESPONSE_BODY || '{}',{status,headers:{'content-type':'application/json'}});
};`);
  async function run(args,{env={}}={}) {
    const capture=path.join(dir,`capture-${Math.random()}.json`);
    const child=spawn(process.execPath,['--no-warnings','--import',pathToFileURL(mock).href,'cli/hostlet.js',...args],{cwd:process.cwd(),env:{...process.env,HOSTLET_URL:'https://example.test',HOSTLET_TOKEN:token,CAPTURE:capture,...env}});
    let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.stdin.end();
    const code=await new Promise(resolve=>child.on('close',resolve));
    const requests=await fs.readFile(capture,'utf8').then(value=>value.trim().split('\n').map(JSON.parse),()=>[]);
    assert.ok(!stdout.includes(token) && !stderr.includes(token));
    return {code,stdout,stderr,requests,request:requests.at(-1) || null};
  }
  return {run};
}

test('rename patches the application title',async t=>{
  const {run}=await fixture(t);
  const page={id:'page 1',title:'New title'};
  const result=await run(['rename','--workspace','space /','--page',page.id,'--title','New title','--json'],{env:{RESPONSE_BODY:JSON.stringify({page})}});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'PATCH');
  assert.equal(result.request.url,'https://example.test/api/cli/workspaces/space%20%2F/pages/page%201');
  assert.deepEqual(result.request.json,{title:'New title'});
  assert.deepEqual(JSON.parse(result.stdout),{page});
});

test('rename requires a title',async t=>{
  const {run}=await fixture(t);
  const result=await run(['rename','--workspace','space','--page','page']);
  assert.equal(result.code,1);
  assert.equal(result.requests.length,0);
});

test('delete-app refuses to run without --confirm',async t=>{
  const {run}=await fixture(t);
  const result=await run(['delete-app','--workspace','space','--page','page']);
  assert.equal(result.code,1);
  assert.match(result.stderr,/cannot be undone/);
  assert.equal(result.requests.length,0);
});

test('delete-app sends a DELETE with the confirmation flag',async t=>{
  const {run}=await fixture(t);
  const result=await run(['delete-app','--workspace','space /','--page','page 1','--confirm','--json'],{env:{RESPONSE_STATUS:'204'}});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'DELETE');
  assert.equal(result.request.url,'https://example.test/api/cli/workspaces/space%20%2F/pages/page%201');
  assert.deepEqual(JSON.parse(result.stdout),{deleted:true,pageId:'page 1'});
});

test('delete-release sends the current revision and reports the next one',async t=>{
  const {run}=await fixture(t);
  const result=await run(['delete-release','--workspace','space','--page','page','--release','release/old','--revision','4','--json'],{env:{RESPONSE_STATUS:'200',RESPONSE_BODY:JSON.stringify({revision:5})}});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'DELETE');
  assert.equal(result.request.url,'https://example.test/api/cli/workspaces/space/pages/page/releases/release%2Fold');
  assert.deepEqual(result.request.json,{revision:4});
  assert.deepEqual(JSON.parse(result.stdout),{revision:5});
});

test('delete-release rejects a response without the next revision',async t=>{
  const {run}=await fixture(t);
  const result=await run(['delete-release','--workspace','space','--page','page','--release','r1','--revision','2'],{env:{RESPONSE_STATUS:'200',RESPONSE_BODY:'{}'}});
  assert.equal(result.code,1);
  assert.match(result.stderr,/invalid response/i);
});

test('delete-release rejects a non-numeric revision before sending',async t=>{
  const {run}=await fixture(t);
  const result=await run(['delete-release','--workspace','space','--page','page','--release','r1','--revision','latest']);
  assert.equal(result.code,1);
  assert.equal(result.requests.length,0);
});
