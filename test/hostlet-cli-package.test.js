import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

function runNpm(args,env) {
  return new Promise(resolve=>{
    const child=spawn(process.platform==='win32' ? 'npm.cmd' : 'npm',args,{
      cwd:process.cwd(),env,shell:process.platform==='win32',stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='';
    child.stdout.on('data',value=>stdout+=value);
    child.stderr.on('data',value=>stderr+=value);
    child.on('close',code=>resolve({code,stdout,stderr}));
  });
}

test('CLI manifest is standalone and points at the executable',async()=>{
  const dir=path.join(process.cwd(),'cli');
  const pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));
  assert.equal(pkg.name,'hostlet-cli');
  assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
  assert.equal(pkg.private,undefined);
  assert.equal(pkg.type,'module');
  assert.deepEqual(pkg.bin,{hostlet:'hostlet.js'});
  assert.deepEqual(Object.keys(pkg.dependencies),['jszip']);
  assert.ok(pkg.engines.node.includes('22.13'));
  for (const file of ['hostlet.js','README.md','LICENSE']) await fs.access(path.join(dir,file));
  const script=await fs.readFile(path.join(dir,'hostlet.js'),'utf8');
  assert.match(script,/^#!\/usr\/bin\/env node/);
});

test('npm pack includes only the standalone CLI files',async t=>{
  const cache=await fs.mkdtemp(path.join(os.tmpdir(),'hostlet-npm-pack-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  const result=await runNpm(['pack','--dry-run','--json','./cli'],{
    ...process.env,
    npm_config_cache:cache,
    npm_config_offline:'true',
    npm_config_update_notifier:'false',
    npm_config_audit:'false',
    npm_config_fund:'false'
  });
  assert.equal(result.code,0,result.stderr);
  const [summary]=JSON.parse(result.stdout);
  assert.equal(summary.name,'hostlet-cli');
  assert.deepEqual(summary.files.map(file=>file.path).sort(),['LICENSE','README.md','hostlet.js','package.json']);
  assert.equal(summary.files.find(file=>file.path==='hostlet.js').mode & 0o777,0o755);
});
