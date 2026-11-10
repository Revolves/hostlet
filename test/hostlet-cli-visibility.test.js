import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const token='T'.repeat(43);
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-cli-visibility-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const mock=path.join(dir,'mock.mjs');
  await fs.writeFile(mock, `import fs from 'node:fs/promises';
globalThis.fetch=async (url,options={})=>{
  const method=options.method||'GET';
  let json=null;
  if (typeof options.body==='string') { try { json=JSON.parse(options.body); } catch {} }
  await fs.appendFile(process.env.CAPTURE,JSON.stringify({url:String(url),method,headers:options.headers,json})+'\\n');
  const status=Number(process.env.RESPONSE_STATUS || '200');
  return new Response(process.env.RESPONSE_BODY || '{}',{status,headers:{'content-type':'application/json'}});
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

test('visibility publishes an application with a PATCH to the CLI route',async t=>{
  const {run}=await fixture(t);
  const result=await run(['visibility','public','--workspace','space /','--page','page 1','--json'],{env:{RESPONSE_BODY:JSON.stringify({visibility:'public'})}});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'PATCH');
  assert.equal(result.request.url,'https://example.test/api/cli/workspaces/space%20%2F/pages/page%201/visibility');
  assert.deepEqual(result.request.json,{visibility:'public'});
  assert.equal(result.request.headers.Authorization,`Bearer ${token}`);
  assert.deepEqual(JSON.parse(result.stdout),{visibility:'public'});
});

test('visibility can revert an application to private and prints text',async t=>{
  const {run}=await fixture(t);
  const result=await run(['visibility','private','--workspace','space','--page','page'],{env:{RESPONSE_BODY:JSON.stringify({visibility:'private'})}});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'PATCH');
  assert.deepEqual(result.request.json,{visibility:'private'});
  assert.equal(result.stdout.trim(),'Application page is now private.');
});

test('visibility rejects unknown values before sending a request',async t=>{
  const {run}=await fixture(t);
  const result=await run(['visibility','unlisted','--workspace','space','--page','page']);
  assert.equal(result.code,1);
  assert.equal(result.requests.length,0);
  assert.match(result.stderr,/hostlet visibility <public\|private>/);
});

test('visibility refuses a response that does not confirm the new state',async t=>{
  const {run}=await fixture(t);
  const result=await run(['visibility','public','--workspace','space','--page','page'],{env:{RESPONSE_BODY:JSON.stringify({visibility:'private'})}});
  assert.equal(result.code,1);
  assert.match(result.stderr,/invalid response/i);
  assert.ok(!result.stdout.includes('is now public'));
});
