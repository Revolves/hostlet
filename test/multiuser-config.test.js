import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../server/config.js";
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const base = { ADMIN_PASSWORD: "test-password", APP_SECRET: "0123456789abcdef0123456789abcdef" };

test('example credentials cannot be used to start the service',()=>{
  assert.throws(()=>loadConfig({...base,ADMIN_PASSWORD:'replace-with-a-long-password'}),/ADMIN_PASSWORD/);
  assert.throws(()=>loadConfig({...base,APP_SECRET:'replace-with-at-least-32-random-characters'}),/APP_SECRET/);
  assert.throws(()=>loadConfig({...base,ADMIN_PASSWORD:'REPLACE_WITH_PRIVATE_PASSWORD'}),/ADMIN_PASSWORD/);
  assert.throws(()=>loadConfig({...base,APP_SECRET:'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS'}),/APP_SECRET/);
});

test('startup rejects example credentials before creating the data directory',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'hostlet-config-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'data');
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../server/index.js',import.meta.url))],{
    env:{...process.env,ADMIN_PASSWORD:'replace-with-a-long-password',APP_SECRET:base.APP_SECRET,DATA_DIR:dataDir,MULTIUSER_ENABLED:'false'},encoding:'utf8'
  });
  assert.notEqual(child.status,0);assert.match(child.stderr,/ADMIN_PASSWORD/);assert.doesNotMatch(child.stderr,/replace-with-a-long-password/);
  assert.equal(existsSync(dataDir),false);
});

test("multiuser mode requires SMTP configuration and refuses insecure production settings", () => {
  assert.equal(loadConfig(base).multiuserEnabled, false);
  assert.throws(() => loadConfig({ ...base, MULTIUSER_ENABLED: "true" }), /SMTP_HOST/);
  const configured = loadConfig({ ...base, MULTIUSER_ENABLED: "true", REGISTRATION_ENABLED: "true", SMTP_HOST: "smtp.example.org", SMTP_FROM: "noreply@example.org", SMTP_PORT: "587", SMTP_SECURITY: "starttls" });
  assert.equal(configured.registrationEnabled, true);
  assert.equal(configured.smtp.port, 587);
  assert.throws(() => loadConfig({ ...base, MULTIUSER_ENABLED: "true", SMTP_HOST: "smtp.example.org", SMTP_FROM: "x@example.org", SMTP_SECURITY: "plain" }), /SMTP_SECURITY/);
  assert.throws(() => loadConfig({ ...base, MULTIUSER_ENABLED: "true", SMTP_HOST: "smtp.example.org", SMTP_FROM: "x@example.org", SMTP_USER: "x" }), /SMTP_PASSWORD/);
  assert.throws(() => loadConfig({ ...base, MULTIUSER_ENABLED: "true", SMTP_HOST: "smtp.example.org", SMTP_FROM: "x@example.org", ADMIN_ORIGIN: "https://admin.example.org" }), /COOKIE_SECURE/);
  assert.throws(() => loadConfig({ ...base, MULTIUSER_ENABLED: "true", SMTP_HOST: "smtp.example.org", SMTP_FROM: "x@example.org", SMTP_PORT: "587invalid" }), /SMTP_PORT/);
});

test('single IP hosting requires explicit TLS origins, one IP, distinct ports and closed registration', () => {
  const env = { ...base, MULTIUSER_ENABLED:'true', SMTP_HOST:'smtp.example.org', SMTP_FROM:'noreply@example.org',
    ADMIN_ORIGIN:'https://192.0.2.1:30006', SINGLE_IP_CONTENT_ORIGIN:'https://192.0.2.1:30007', COOKIE_SECURE:'true' };
  assert.deepEqual(loadConfig(env).ipHosting, {managementOrigin:env.ADMIN_ORIGIN,contentOrigin:env.SINGLE_IP_CONTENT_ORIGIN});
  for (const overrides of [
    {REGISTRATION_ENABLED:'true'}, {APPS_DOMAIN:'apps.example.org'}, {COOKIE_SECURE:'false'},
    {ADMIN_ORIGIN:'http://192.0.2.1:30006'}, {SINGLE_IP_CONTENT_ORIGIN:'https://192.0.2.2:30007'},
    {SINGLE_IP_CONTENT_ORIGIN:'https://192.0.2.1:30006'}, {SINGLE_IP_CONTENT_ORIGIN:'https://192.0.2.1:30007/path'},
    {SINGLE_IP_CONTENT_ORIGIN:'https://example.org:30007'}, {MULTIUSER_ENABLED:'false'}
  ]) assert.throws(() => loadConfig({...env,...overrides}), /IP|origin|registration|REGISTRATION|COOKIE|MULTIUSER|APPS_DOMAIN/i);
});

test('unsafe single IP registration fails before opening the data directory', t => {
  const root=mkdtempSync(path.join(tmpdir(),'hostlet-ip-config-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'data');
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../server/index.js',import.meta.url))],{
    env:{...process.env,...base,DATA_DIR:dataDir,MULTIUSER_ENABLED:'true',SMTP_HOST:'smtp.example.org',SMTP_FROM:'noreply@example.org',
      ADMIN_ORIGIN:'https://192.0.2.1:30006',SINGLE_IP_CONTENT_ORIGIN:'https://192.0.2.1:30007',COOKIE_SECURE:'true',REGISTRATION_ENABLED:'true',APPS_DOMAIN:'',ADMIN_ORIGINS:''},encoding:'utf8'
  });
  assert.notEqual(child.status,0); assert.match(child.stderr,/Invalid single IP hosting configuration/);
  assert.equal(existsSync(dataDir),false);
});
