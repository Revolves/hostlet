import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const token='T'.repeat(43);
const commands=['register','login','logout','whoami','keys','workspaces','pages','versions','publish','publish-status','rollback','shares','share','revoke-share'];

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-cli-help-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const mock=path.join(dir,'no-network.mjs');
  await fs.writeFile(mock,`globalThis.fetch=()=>{process.stderr.write('FETCH_CALLED\\n');throw new Error('network disabled');}`);
  function run(args,{env={}}={}) {
    const childEnv={...process.env};
    for (const key of ['HOSTLET_URL','HOSTLET_TOKEN','HOSTLET_CONFIG','HOSTLET_SHARE_PASSWORD']) delete childEnv[key];
    Object.assign(childEnv,env);
    return new Promise(resolve=>{
      const child=spawn(process.execPath,['--no-warnings','--import',pathToFileURL(mock).href,'cli/hostlet.js',...args],{
        cwd:process.cwd(),env:childEnv,stdio:['ignore','pipe','pipe']
      });
      let stdout='',stderr='';
      child.stdout.on('data',value=>stdout+=value);
      child.stderr.on('data',value=>stderr+=value);
      child.on('close',code=>resolve({code,stdout,stderr}));
    });
  }
  return {run};
}

test('help and version work without credentials and never touch the network',async t=>{
  const {run}=await fixture(t);
  for (const args of [['--help'],['-h'],['help']]) {
    const result=await run(args);
    assert.equal(result.code,0,result.stderr);
    for (const text of [
      'Usage:','hostlet help <command>','HOSTLET_URL','HOSTLET_TOKEN','HOSTLET_CONFIG','HOSTLET_SHARE_PASSWORD',
      'Defaults to https://hostlet.cn','Never pass it on the command line','Remote instances must use HTTPS'
    ]) assert.ok(result.stdout.includes(text),`${args.join(' ')} should mention ${text}`);
    for (const command of commands) assert.ok(result.stdout.includes(`  ${command}`),`help should list ${command}`);
    assert.doesNotMatch(result.stderr,/FETCH_CALLED/);
  }
});

test('every command has help through both help forms',async t=>{
  const {run}=await fixture(t);
  for (const command of commands) {
    for (const args of [['help',command],[command,'--help']]) {
      const result=await run(args);
      assert.equal(result.code,0,result.stderr);
      assert.ok(result.stdout.includes(`hostlet ${command}`),`${args.join(' ')} should show the command usage`);
      assert.ok(result.stdout.includes('Options:'),`${args.join(' ')} should list options`);
      assert.doesNotMatch(result.stderr,/FETCH_CALLED/);
    }
  }
});

test('publish help documents replacement, entry and recovery options',async t=>{
  const {run}=await fixture(t);
  for (const args of [['help','publish'],['publish','--help']]) {
    const result=await run(args);
    assert.equal(result.code,0,result.stderr);
    for (const option of ['--workspace','--title','--entry','--page','--revision','--request-id','--json']) {
      assert.ok(result.stdout.includes(option),`${args.join(' ')} should document ${option}`);
    }
    assert.ok(result.stdout.includes('private'));
    assert.ok(result.stdout.includes('publish-status'));
  }
});

test('account help documents zero-to-publish onboarding and key management',async t=>{
  const {run}=await fixture(t);
  const register=await run(['help','register']);
  assert.equal(register.code,0,register.stderr);
  for (const text of ['--username','--password-stdin','--key-name','--scopes','--expires','--no-key','--json']) {
    assert.ok(register.stdout.includes(text),`register help should document ${text}`);
  }
  assert.match(register.stdout,/at least 12 characters/);
  assert.match(register.stdout,/shown once/);

  const login=await run(['login','--help']);
  assert.equal(login.code,0,login.stderr);
  for (const text of ['--identifier','--password-stdin','--key-name']) assert.ok(login.stdout.includes(text));

  const keys=await run(['keys','--help']);
  assert.equal(keys.code,0,keys.stderr);
  for (const text of ['list','create','revoke','--id','--password-stdin']) assert.ok(keys.stdout.includes(text));
  assert.match(keys.stdout,/saved account session/);
});

test('version matches the standalone package manifest',async t=>{
  const {run}=await fixture(t);
  const pkg=JSON.parse(await fs.readFile(path.join(process.cwd(),'cli','package.json'),'utf8'));
  for (const args of [['--version'],['-v']]) {
    const result=await run(args);
    assert.equal(result.code,0,result.stderr);
    assert.equal(result.stdout.trim(),`hostlet-cli ${pkg.version}`);
    assert.doesNotMatch(result.stderr,/FETCH_CALLED/);
  }
});

test('missing and unknown commands fail before credential validation',async t=>{
  const {run}=await fixture(t);
  const missing=await run([]);
  assert.equal(missing.code,1);
  assert.match(missing.stderr,/Usage:/);
  assert.match(missing.stderr,/No command supplied/);
  assert.doesNotMatch(missing.stderr,/Set HOSTLET_URL and HOSTLET_TOKEN/);
  assert.doesNotMatch(missing.stderr,/FETCH_CALLED/);

  const unknown=await run(['does-not-exist']);
  assert.equal(unknown.code,1);
  assert.equal(unknown.stdout,'');
  assert.match(unknown.stderr,/unknown command "does-not-exist"/);
  assert.match(unknown.stderr,/hostlet --help/);
  assert.doesNotMatch(unknown.stderr,/Set HOSTLET_URL and HOSTLET_TOKEN/);
  assert.doesNotMatch(unknown.stderr,/FETCH_CALLED/);

  const unknownHelp=await run(['help','does-not-exist']);
  assert.equal(unknownHelp.code,1);
  assert.match(unknownHelp.stderr,/unknown command "does-not-exist"/);
  assert.doesNotMatch(unknownHelp.stderr,/FETCH_CALLED/);

  const extraHelp=await run(['help','publish','extra']);
  assert.equal(extraHelp.code,1);
  assert.match(extraHelp.stderr,/single command name/);
});

test('help, version and unknown commands never echo the credential',async t=>{
  const {run}=await fixture(t);
  for (const args of [['--help'],['--version'],['help','publish'],['publish','--help'],[token]]) {
    const result=await run(args,{env:{HOSTLET_TOKEN:token}});
    assert.ok(!result.stdout.includes(token),`stdout leaked the token for ${args.join(' ')}`);
    assert.ok(!result.stderr.includes(token),`stderr leaked the token for ${args.join(' ')}`);
  }
  const unknown=await run([token],{env:{HOSTLET_TOKEN:token}});
  assert.match(unknown.stderr,/\[redacted\]/);
  assert.match(unknown.stderr,/unknown command/);
});
