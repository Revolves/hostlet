import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const token='T'.repeat(43), shareToken='S'.repeat(43);
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-cli-share-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const mock=path.join(dir,'mock.mjs');
  await fs.writeFile(mock, `import fs from 'node:fs/promises';
globalThis.fetch=async (url,options={})=>{
  const method=options.method||'GET';
  let json=null;
  if (typeof options.body==='string') { try { json=JSON.parse(options.body); } catch {} }
  await fs.appendFile(process.env.CAPTURE,JSON.stringify({url:String(url),method,headers:options.headers,json})+'\\n');
  if(process.env.FAIL_FETCH) throw new Error('transport '+process.env.HOSTLET_TOKEN);
  const status=Number(process.env.RESPONSE_STATUS || (method==='DELETE' ? '204' : '200'));
  const body=status===204 ? null : process.env.RESPONSE_BODY || '{}';
  return new Response(body,{status,headers:{'content-type':'application/json'}});
};`);
  async function run(args,{env={},input=''}={}) {
    const capture=path.join(dir,`capture-${Math.random()}.json`);
    const child=spawn(process.execPath,['--no-warnings','--import',pathToFileURL(mock).href,'cli/hostlet.js',...args],{cwd:process.cwd(),env:{...process.env,HOSTLET_URL:'https://example.test',HOSTLET_TOKEN:token,CAPTURE:capture,...env}});
    let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.stdin.end(input);
    const code=await new Promise(resolve=>child.on('close',resolve));
    const requests=await fs.readFile(capture,'utf8').then(value=>value.trim().split('\n').map(JSON.parse),()=>[]);
    assert.ok(!stdout.includes(token) && !stderr.includes(token));
    return {code,stdout,stderr,requests,request:requests.at(-1) || null};
  }
  return {run};
}

test('rollback activates a release with the current revision',async t=>{
  const {run}=await fixture(t);
  const page={id:'page 1',releaseId:'release/old',revision:3};
  const result=await run(['rollback','--workspace','space /','--page',page.id,'--release',page.releaseId,'--revision','2','--json'],{env:{RESPONSE_BODY:JSON.stringify({page})}});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'POST');
  assert.equal(result.request.url,'https://example.test/api/cli/workspaces/space%20%2F/pages/page%201/releases/release%2Fold/activate');
  assert.deepEqual(result.request.json,{revision:2});
  assert.equal(result.request.headers.Authorization,`Bearer ${token}`);
  assert.deepEqual(JSON.parse(result.stdout),{page});
  const human=await run(['rollback','--workspace','space','--page','page','--release','release','--revision','2'],{env:{RESPONSE_BODY:JSON.stringify({page})}});
  assert.match(human.stdout,/Activated application page 1/);
  assert.match(human.stdout,/release\/old/);
});

test('rollback rejects invalid or unrelated options before making a request',async t=>{
  const {run}=await fixture(t);
  for (const args of [
    ['rollback','--workspace','space','--page','page','--release','release'],
    ['rollback','--workspace','space','--page','page','--release','release','--revision','-1'],
    ['rollback','--workspace','space','--page','page','--release','release','--revision','1','--title','unexpected'],
    ['rollback','--workspace','space','--page','page','--release','release','--revision','9007199254740992']
  ]) {
    const result=await run(args);
    assert.notEqual(result.code,0);assert.equal(result.request,null);
  }
});

test('rollback surfaces structured API errors and revision guidance',async t=>{
  const {run}=await fixture(t);
  const result=await run(['rollback','--workspace','space','--page','page','--release','release','--revision','2'],{env:{RESPONSE_STATUS:'409',RESPONSE_BODY:'{"code":"CONFLICT"}'}});
  assert.notEqual(result.code,0);assert.equal(result.stdout,'');
  assert.match(result.stderr,/CONFLICT/);assert.match(result.stderr,/latest revision/i);
});

test('shares lists metadata without tokens in JSON and human output',async t=>{
  const {run}=await fixture(t);
  const response={shares:[
    {id:'share-1',passwordProtected:false,createdAt:1000,expiresAt:null,revokedAt:null},
    {id:'share-2',passwordProtected:true,createdAt:2000,expiresAt:9000000000000,revokedAt:null},
    {id:'share-3',passwordProtected:false,createdAt:3000,expiresAt:4000,revokedAt:5000}
  ]};
  const result=await run(['shares','--workspace','space','--page','page','--json'],{env:{RESPONSE_BODY:JSON.stringify(response)}});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.url,'https://example.test/api/cli/workspaces/space/pages/page/shares');
  assert.deepEqual(JSON.parse(result.stdout),response);
  assert.ok(!result.stdout.includes(shareToken));
  const human=await run(['shares','--workspace','space','--page','page'],{env:{RESPONSE_BODY:JSON.stringify(response)}});
  assert.match(human.stdout,/share-1\tactive\tno-password/);
  assert.match(human.stdout,/share-2\tactive\tpassword/);
  assert.match(human.stdout,/share-3\trevoked/);
  const empty=await run(['shares','--workspace','space','--page','page'],{env:{RESPONSE_BODY:'{"shares":[]}'}});
  assert.equal(empty.stdout,'No shares.\n');
});

test('share creation reads a password from stdin and builds the one-time link',async t=>{
  const {run}=await fixture(t);
  const share={id:'share-1',token:shareToken,passwordProtected:true,createdAt:1000,expiresAt:1800000000000,revokedAt:null};
  const expires='2027-01-01T00:00:00.000Z';
  const result=await run(['share','--workspace','space','--page','page 1','--expires',expires,'--password-stdin','--json'],{env:{RESPONSE_BODY:JSON.stringify({share})},input:'secret phrase\n'});
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'POST');
  assert.deepEqual(result.request.json,{password:'secret phrase',expiresAt:Date.parse(expires)});
  const payload=JSON.parse(result.stdout);
  assert.equal(payload.share.id,'share-1');
  const url=new URL(payload.shareUrl);
  assert.equal(url.pathname,'/share');
  assert.equal(url.hash,`#page=page+1&token=${shareToken}`);
  assert.ok(!result.stdout.includes('secret phrase') && !result.stderr.includes('secret phrase'));
  const human=await run(['share','--workspace','space','--page','page'],{env:{RESPONSE_BODY:JSON.stringify({share:{...share,passwordProtected:false}})}});
  assert.match(human.stdout,/Created share share-1/);
  assert.match(human.stdout,/cannot be retrieved again/i);
});

test('share creation warns when the result is unknown',async t=>{
  const {run}=await fixture(t);
  const result=await run(['share','--workspace','space','--page','page'],{env:{RESPONSE_STATUS:'500',RESPONSE_BODY:'{"code":"INTERNAL_ERROR"}'}});
  assert.notEqual(result.code,0);assert.equal(result.stdout,'');
  assert.match(result.stderr,/result unknown/i);assert.match(result.stderr,/cannot be recovered/i);
  const network=await run(['share','--workspace','space','--page','page'],{env:{FAIL_FETCH:'1'}});
  assert.notEqual(network.code,0);assert.match(network.stderr,/result unknown/i);
});

test('share revocation deletes the share and returns JSON',async t=>{
  const {run}=await fixture(t);
  const result=await run(['revoke-share','--workspace','space','--page','page','--share','share/1','--json']);
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.request.method,'DELETE');
  assert.equal(result.request.url,'https://example.test/api/cli/workspaces/space/pages/page/shares/share%2F1');
  assert.deepEqual(JSON.parse(result.stdout),{revoked:true,shareId:'share/1'});
});

test('share commands reject missing identifiers without a request',async t=>{
  const {run}=await fixture(t);
  for (const args of [
    ['shares','--workspace','space'],
    ['share','--page','page'],
    ['revoke-share','--workspace','space','--page','page'],
    ['revoke-share','--workspace','space','--page','page','--share','share','--expires','2030-01-01']
  ]) {
    const result=await run(args);
    assert.notEqual(result.code,0);assert.equal(result.request,null);
  }
});
