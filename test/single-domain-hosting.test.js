import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../server/config.js";
import { openDatabase } from "../server/database.js";
import { createApps } from "../server/app.js";

const password = "a sufficiently long password";
const appHost = `w-${"a".repeat(32)}.apps.hostlet.cn`;

test("single-domain hosting keeps management and application hosts separated", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hostlet-single-domain-"));
  const db = openDatabase(":memory:");
  const config = loadConfig({
    ADMIN_PASSWORD: "test-admin-password",
    APP_SECRET: "0123456789abcdef0123456789abcdef",
    DATA_DIR: dir,
    MULTIUSER_ENABLED: "true",
    USERNAME_REGISTRATION_ENABLED: "true",
    REGISTRATION_ENABLED: "true",
    ADMIN_ORIGIN: "https://hostlet.cn",
    COOKIE_SECURE: "true",
    APPS_DOMAIN: "apps.hostlet.cn",
    SINGLE_DOMAIN_HOSTING: "true",
  });
  const { admin, hosted } = await createApps({ config, db });
  const adminServer = http.createServer(admin);
  const hostedServer = http.createServer(hosted);
  await new Promise(resolve => adminServer.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => hostedServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${adminServer.address().port}`;
  const hostedPort = hostedServer.address().port;
  config.allowedOrigins.splice(0, config.allowedOrigins.length, base);
  t.after(async () => {
    await new Promise(resolve => adminServer.close(resolve));
    await new Promise(resolve => hostedServer.close(resolve));
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const features = await (await fetch(`${base}/api/features`)).json();
  assert.equal(features.multiuser, true);
  assert.equal(features.singleDomainHosting, true);
  assert.equal(features.hostingDomain, "apps.hostlet.cn");

  const registered = await fetch(`${base}/api/account/register`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "demo_owner", password }),
  });
  assert.equal(registered.status, 201);
  const accountCookie = registered.headers.getSetCookie().find(value => value.startsWith("__Host-hostlet_account="));
  assert.ok(accountCookie);
  assert.match(accountCookie, /; Secure/);
  assert.match(accountCookie, /; Path=\//);
  assert.doesNotMatch(accountCookie, /; Domain=/i);

  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-admin-password" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.getSetCookie().find(value => value.startsWith("__Host-hostlet_admin="));
  assert.ok(adminCookie);
  assert.match(adminCookie, /; Secure/);
  assert.match(adminCookie, /; Path=\//);
  assert.doesNotMatch(adminCookie, /; Domain=/i);

  const appRequest = await new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: hostedPort,
      path: "/api/account/me",
      headers: { Host: appHost },
    }, response => {
      response.once("end", () => resolve(response.statusCode));
      response.resume();
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(appRequest, 421);

  const crossOrigin = await fetch(`${base}/api/account/me`, {
    headers: { Origin: `https://${appHost}` },
  });
  assert.equal(crossOrigin.status, 403);
});
