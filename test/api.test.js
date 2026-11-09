import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { loadConfig } from "../server/config.js";
import { openDatabase } from "../server/database.js";
import { createApps } from "../server/app.js";

const PASSWORD = "correct horse battery staple";
const SECRET = "0123456789abcdef0123456789abcdef";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function setup(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hostlet-api-"));
  const config = loadConfig({
    ADMIN_PASSWORD: PASSWORD,
    APP_SECRET: SECRET,
    ADMIN_PORT: "3100",
    PAGES_PORT: "8100",
    DATA_DIR: directory,
    PUBLIC_BASE_URL: "http://127.0.0.1:8100",
  });
  const db = openDatabase(":memory:");
  const { admin, hosted, services } = await createApps({ config, db });
  const adminServer = await listen(admin);
  const pagesServer = await listen(hosted);
  config.publicBaseUrl = pagesServer.origin;
  config.adminOrigin = adminServer.origin;
  config.allowedOrigins = [adminServer.origin];

  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => adminServer.server.close(resolve)),
      new Promise((resolve) => pagesServer.server.close(resolve)),
    ]);
    db.close();
    await fs.promises.rm(directory, { recursive: true, force: true });
  });

  return { admin: adminServer.origin, pages: pagesServer.origin, config, services };
}

async function login(origin) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie()[0].split(";")[0];
  return cookie;
}

function adminHeaders(origin, cookie) {
  return { Origin: origin, Cookie: cookie };
}

async function uploadHtml(origin, cookie, fields, filename = "index.html") {
  const form = new FormData();
  form.set("title", fields.title);
  form.set("slug", fields.slug);
  form.set("entryFile", fields.entryFile || "index.html");
  form.set("accessMode", fields.accessMode || "public");
  form.set("file", new Blob([fields.html || "<h1>Hosted</h1>"], { type: "text/html" }), filename);
  return fetch(`${origin}/api/pages`, {
    method: "POST",
    headers: adminHeaders(origin, cookie),
    body: form,
  });
}

test("requires a configured admin password and distinct ports", () => {
  assert.throws(() => loadConfig({ ADMIN_PASSWORD: "", APP_SECRET: SECRET }), /ADMIN_PASSWORD/);
  assert.throws(
    () => loadConfig({ ADMIN_PASSWORD: PASSWORD, APP_SECRET: SECRET, ADMIN_PORT: "3000", PAGES_PORT: "3000" }),
    /must be different/,
  );
  assert.throws(
    () => loadConfig({ ADMIN_PASSWORD: PASSWORD, APP_SECRET: "short" }),
    /at least 32/,
  );
});

test("admin session protects API and rejects cross-origin mutations", async (t) => {
  const app = await setup(t);

  assert.equal((await fetch(`${app.admin}/api/pages`)).status, 401);
  assert.equal((await login(app.admin)).startsWith("hostlet_admin="), true);

  const cookie = await login(app.admin);
  const rejected = await fetch(`${app.admin}/api/pages`, {
    method: "POST",
    headers: { Origin: "https://evil.example", Cookie: cookie },
    body: new FormData(),
  });
  assert.equal(rejected.status, 403);
});

test("a direct client cannot evade login rate limits by forging forwarded addresses", async (t) => {
  const app = await setup(t);
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`${app.admin}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: app.admin, "X-Forwarded-For": `198.51.100.${i + 1}` },
      body: JSON.stringify({ password: "wrong" }),
    });
    assert.equal(response.status, 401);
  }
  const blocked = await fetch(`${app.admin}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: app.admin, "X-Forwarded-For": "198.51.100.9" },
    body: JSON.stringify({ password: "wrong" }),
  });
  assert.equal(blocked.status, 429);
});

test("uploads, serves, edits, previews, replaces, and deletes a page", async (t) => {
  const app = await setup(t);
  const cookie = await login(app.admin);

  const created = await uploadHtml(app.admin, cookie, {
    title: "Product Demo",
    slug: "product-demo",
    accessMode: "public",
    html: "<!doctype html><title>Demo</title><h1>Hello Hostlet</h1>",
  });
  assert.equal(created.status, 201);
  const { page } = await created.json();
  assert.equal(page.slug, "product-demo");
  assert.equal(page.url, `${app.pages}/p/product-demo/`);

  const served = await fetch(`${app.pages}/p/product-demo/`);
  assert.equal(served.status, 200);
  assert.match(await served.text(), /Hello Hostlet/);

  const canonical = await fetch(`${app.pages}/p/product-demo`, { redirect: "manual" });
  assert.equal(canonical.status, 302);
  assert.equal(canonical.headers.get("location"), "/p/product-demo/");
  assert.equal((await fetch(`${app.pages}/p/product-demo/missing`, { redirect: "manual" })).status, 404);

  const conflict = await uploadHtml(app.admin, cookie, {
    title: "Duplicate",
    slug: "product-demo",
  });
  assert.equal(conflict.status, 409);

  const editedResponse = await fetch(`${app.admin}/api/pages/${page.id}`, {
    method: "PATCH",
    headers: { ...adminHeaders(app.admin, cookie), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Product Launch", slug: "launch", accessMode: "private" }),
  });
  assert.equal(editedResponse.status, 200);

  const locked = await fetch(`${app.pages}/p/launch/`);
  assert.equal(locked.status, 401);
  assert.match(await locked.text(), /This page is private/);

  const chineseGate = await fetch(`${app.pages}/p/launch/?lang=zh-CN`);
  assert.equal(chineseGate.status, 401);
  const chineseGateHtml = await chineseGate.text();
  assert.match(chineseGateHtml, /<html lang="zh-CN">/);
  assert.match(chineseGateHtml, /此页面为私有页面/);
  assert.doesNotMatch(chineseGateHtml, /Hostlet/);
  assert.match(chineseGateHtml, /name="lang" value="zh-CN"/);
  assert.equal(chineseGate.headers.get("content-language"), "zh-CN");
  const wrongChinesePassword = await fetch(`${app.pages}/__host/login`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ slug: "launch", password: "incorrect", lang: "zh-CN" }),
  });
  assert.equal(await wrongChinesePassword.text(), "密码错误。");

  const loginResponse = await fetch(`${app.pages}/__host/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ slug: "launch", password: PASSWORD }),
    redirect: "manual",
  });
  assert.equal(loginResponse.status, 303);
  const loginLocation = loginResponse.headers.get("location");
  assert.match(loginLocation, /^\/p\/launch\/__host\/[^/]+\/$/);
  const pageCookie = loginResponse.headers.getSetCookie()[0].split(";")[0];
  const unlocked = await fetch(`${app.pages}${loginLocation}`, { headers: { Cookie: pageCookie } });
  assert.equal(unlocked.status, 200);
  assert.match(unlocked.headers.get("content-security-policy"), /^sandbox /);
  assert.doesNotMatch(unlocked.headers.get("content-security-policy"), /allow-same-origin/);

  const previewResponse = await fetch(`${app.admin}/api/pages/${page.id}/preview-link`, {
    method: "POST",
    headers: adminHeaders(app.admin, cookie),
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const previewWithoutCookie = await fetch(preview.url);
  assert.equal(previewWithoutCookie.status, 200);
  assert.match(await previewWithoutCookie.text(), /<base href="\/p\/launch\/__host\//);

  const replacement = await fetch(`${app.admin}/api/pages/${page.id}/replace`, {
    method: "POST",
    headers: adminHeaders(app.admin, cookie),
    body: (() => {
      const form = new FormData();
      form.set("entryFile", "index.html");
      form.set("file", new Blob(["<h1>Replacement</h1>"], { type: "text/html" }), "new.html");
      return form;
    })(),
  });
  assert.equal(replacement.status, 200);
  const replacementPreview = await fetch(`${app.admin}/api/pages/${page.id}/preview-link`, {
    method: "POST",
    headers: adminHeaders(app.admin, cookie),
  });
  const replacementPreviewUrl = (await replacementPreview.json()).url;
  const replaced = await fetch(replacementPreviewUrl);
  assert.match(await replaced.text(), /Replacement/);

  const deleted = await fetch(`${app.admin}/api/pages/${page.id}`, {
    method: "DELETE",
    headers: adminHeaders(app.admin, cookie),
  });
  assert.equal(deleted.status, 204);
  assert.equal((await fetch(`${app.pages}/p/launch/`)).status, 404);
});

test("extracts ZIP sites and serves nested assets with safe content types", async (t) => {
  const app = await setup(t);
  const cookie = await login(app.admin);
  const zip = new JSZip();
  zip.file("bundle/index.html", "<link rel='stylesheet' href='assets/site.css'><h1>Zip site</h1>");
  zip.file("bundle/assets/site.css", "body { color: rgb(1, 2, 3); }");
  zip.file("bundle/assets/pixel.png", Buffer.from([137, 80, 78, 71]));
  zip.file("bundle/assets/site.woff2", Buffer.from([119, 79, 70, 50]));
  const archive = await zip.generateAsync({ type: "nodebuffer" });

  const form = new FormData();
  form.set("title", "Zip Site");
  form.set("slug", "zip-site");
  form.set("entryFile", "index.html");
  form.set("accessMode", "public");
  form.set("file", new Blob([archive], { type: "application/zip" }), "bundle.zip");
  const response = await fetch(`${app.admin}/api/pages`, {
    method: "POST",
    headers: adminHeaders(app.admin, cookie),
    body: form,
  });
  assert.equal(response.status, 201);

  const html = await fetch(`${app.pages}/p/zip-site/`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /text\/html/);
  assert.match(await html.text(), /Zip site/);

  const css = await fetch(`${app.pages}/p/zip-site/assets/site.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  assert.equal(css.headers.get("access-control-allow-origin"), null);
  assert.match(await css.text(), /rgb\(1, 2, 3\)/);

  const font = await fetch(`${app.pages}/p/zip-site/assets/site.woff2`);
  assert.equal(font.status, 200);
  assert.match(font.headers.get("content-type"), /font\/woff2/);
  assert.equal(font.headers.get("access-control-allow-origin"), "*");
});
test("private ZIP assets stay available through a signed token path", async (t) => {
  const app = await setup(t);
  const cookie = await login(app.admin);
  const zip = new JSZip();
  zip.file("index.html", "<link rel='stylesheet' href='assets/site.css'><h1>Private ZIP</h1>");
  zip.file("assets/site.css", "body { color: rgb(4, 5, 6); }");
  const archive = await zip.generateAsync({ type: "nodebuffer" });

  const form = new FormData();
  form.set("title", "Private ZIP");
  form.set("slug", "private-zip");
  form.set("entryFile", "index.html");
  form.set("accessMode", "private");
  form.set("file", new Blob([archive], { type: "application/zip" }), "private.zip");
  const response = await fetch(`${app.admin}/api/pages`, {
    method: "POST",
    headers: adminHeaders(app.admin, cookie),
    body: form,
  });
  assert.equal(response.status, 201);

  const loginResponse = await fetch(`${app.pages}/__host/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ slug: "private-zip", password: PASSWORD }),
    redirect: "manual",
  });
  assert.equal(loginResponse.status, 303);
  const tokenPath = loginResponse.headers.get("location");
  const pageCookie = loginResponse.headers.getSetCookie()[0].split(";")[0];

  const redirected = await fetch(`${app.pages}/p/private-zip/`, {
    headers: { Cookie: pageCookie }, redirect: "manual",
  });
  assert.equal(redirected.headers.get("location"), tokenPath);
  const html = await fetch(`${app.pages}${tokenPath}`);
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes(`<base href="${tokenPath}">`));

  const anonymousCss = await fetch(`${app.pages}/p/private-zip/assets/site.css`);
  assert.equal(anonymousCss.status, 401);

  const css = await fetch(`${app.pages}${tokenPath}assets/site.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  assert.match(await css.text(), /rgb\(4, 5, 6\)/);
});

test("a replacement keeps the previous version available for rollback", async (t) => {
  const app = await setup(t);
  const cookie = await login(app.admin);
  const created = await uploadHtml(app.admin, cookie, { title: "Versions", slug: "versions", html: "<h1>Original</h1>" });
  const { page } = await created.json();
  const preview = await fetch(`${app.admin}/api/pages/${page.id}/preview-link`, { method: "POST", headers: adminHeaders(app.admin, cookie) });
  const oldPreviewUrl = (await preview.json()).url;
  const form = new FormData();
  form.set("entryFile", "index.html");
  form.set("file", new Blob(["<h1>Updated</h1>"], { type: "text/html" }), "updated.html");
  const replacement = await fetch(`${app.admin}/api/pages/${page.id}/replace`, { method: "POST", headers: adminHeaders(app.admin, cookie), body: form });
  assert.equal(replacement.status, 200);
  const response = await fetch(`${app.admin}/api/pages/${page.id}/releases`, { headers: adminHeaders(app.admin, cookie) });
  assert.equal(response.status, 200);
  const { releases } = await response.json();
  assert.equal(releases.length, 2);
  const listed = await fetch(`${app.admin}/api/pages`, { headers: adminHeaders(app.admin, cookie) });
  assert.equal((await listed.json()).stats.storageBytes, releases.reduce((total, item) => total + item.sizeBytes, 0));
  const previous = releases.find((release) => release.originalFilename === "index.html");
  const rollback = await fetch(`${app.admin}/api/pages/${page.id}/releases/${previous.releaseId}/activate`, { method: "POST", headers: adminHeaders(app.admin, cookie) });
  assert.equal(rollback.status, 200);
  assert.match(await (await fetch(`${app.pages}/p/versions/`)).text(), /Original/);
  assert.equal((await fetch(oldPreviewUrl)).status, 401);
  assert.equal((await fetch(`${app.admin}/api/pages/${page.id}/releases/not-a-release/activate`, { method: "POST", headers: adminHeaders(app.admin, cookie) })).status, 404);
});

test("editing a version entry file remains in effect after restoring that version", async (t) => {
  const app = await setup(t);
  const cookie = await login(app.admin);
  const zip = new JSZip();
  zip.file("index.html", "<h1>Index</h1>");
  zip.file("other.html", "<h1>Other</h1>");
  const form = new FormData();
  form.set("title", "Entries"); form.set("slug", "entries"); form.set("entryFile", "index.html"); form.set("accessMode", "public");
  form.set("file", new Blob([await zip.generateAsync({ type: "nodebuffer" })]), "site.zip");
  const created = await fetch(`${app.admin}/api/pages`, { method: "POST", headers: adminHeaders(app.admin, cookie), body: form });
  const { page } = await created.json();
  const changed = await fetch(`${app.admin}/api/pages/${page.id}`, { method: "PATCH", headers: { ...adminHeaders(app.admin, cookie), "Content-Type": "application/json" }, body: JSON.stringify({ entryFile: "other.html" }) });
  assert.equal(changed.status, 200);
  const versions = (await (await fetch(`${app.admin}/api/pages/${page.id}/releases`, { headers: adminHeaders(app.admin, cookie) })).json()).releases;
  const restored = await fetch(`${app.admin}/api/pages/${page.id}/releases/${versions[0].releaseId}/activate`, { method: "POST", headers: adminHeaders(app.admin, cookie) });
  assert.equal(restored.status, 200);
  assert.match(await (await fetch(`${app.pages}/p/entries/`)).text(), /Other/);
});

test("an upload started before a publish and rollback cannot overwrite the rollback", async (t) => {
  const app = await setup(t);
  const cookie = await login(app.admin);
  const created = await uploadHtml(app.admin, cookie, { title: "Concurrent", slug: "concurrent", html: "<h1>Original</h1>" });
  const { page } = await created.json();
  const versions = (await (await fetch(`${app.admin}/api/pages/${page.id}/releases`, { headers: adminHeaders(app.admin, cookie) })).json()).releases;
  const originalStage = app.services.storage.stageSingleHtml.bind(app.services.storage);
  let unblock, started;
  const waiting = new Promise(resolve => { unblock = resolve; });
  const stageStarted = new Promise(resolve => { started = resolve; });
  let count = 0;
  app.services.storage.stageSingleHtml = async (...args) => {
    if (++count === 1) { started(); await waiting; }
    return originalStage(...args);
  };
  t.after(() => unblock());
  const replace = text => {
    const form = new FormData(); form.set("entryFile", "index.html"); form.set("file", new Blob([`<h1>${text}</h1>`]), `${text}.html`);
    return fetch(`${app.admin}/api/pages/${page.id}/replace`, { method: "POST", headers: adminHeaders(app.admin, cookie), body: form });
  };
  const first = replace("First");
  await stageStarted;
  assert.equal((await replace("Second")).status, 200);
  assert.equal((await fetch(`${app.admin}/api/pages/${page.id}/releases/${versions[0].releaseId}/activate`, { method: "POST", headers: adminHeaders(app.admin, cookie) })).status, 200);
  unblock();
  assert.equal((await first).status, 409);
  assert.match(await (await fetch(`${app.pages}/p/concurrent/`)).text(), /Original/);
});
