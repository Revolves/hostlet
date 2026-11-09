import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { mock } from "node:test";
import { ServerResponse } from "node:http";
import { loadConfig } from "../server/config.js";
import { openDatabase } from "../server/database.js";
import { createApps } from "../server/app.js";
import { publicCopy } from "../shared/public-site.js";

const PASSWORD = "correct horse battery staple";
const SECRET = "0123456789abcdef0123456789abcdef";
const WORKSPACE_ID = "w-" + "a".repeat(32);

async function setup(t, extra = {}) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hostlet-public-apps-"));
  const config = loadConfig({
    ADMIN_PASSWORD: PASSWORD,
    APP_SECRET: SECRET,
    ADMIN_PORT: "3100",
    PAGES_PORT: "8100",
    DATA_DIR: directory,
    PUBLIC_BASE_URL: "http://127.0.0.1:8100",
    ...extra,
  });
  const adminDist = path.join(directory, "admin-dist");
  fs.mkdirSync(adminDist, { recursive: true });
  fs.writeFileSync(path.join(adminDist, "index.html"), `<!doctype html><html lang="zh-CN"><head><!-- HOSTLET_META_START --><title>Hostlet</title><!-- HOSTLET_META_END --></head><body><div id="root"></div></body></html>`);
  config.adminDistDir = adminDist;
  const db = openDatabase(":memory:");
  const { admin, hosted } = await createApps({ config, db, accountSender: extra.MULTIUSER_ENABLED === "true" ? async () => {} : undefined });
  const adminServer = http.createServer(admin);
  const pagesServer = http.createServer(hosted);
  await Promise.all([
    new Promise((resolve) => adminServer.listen(0, "127.0.0.1", resolve)),
    new Promise((resolve) => pagesServer.listen(0, "127.0.0.1", resolve)),
  ]);
  const adminOrigin = `http://127.0.0.1:${adminServer.address().port}`;
  const pagesOrigin = `http://127.0.0.1:${pagesServer.address().port}`;
  config.publicBaseUrl = pagesOrigin;
  config.adminOrigin = adminOrigin;
  config.allowedOrigins = [adminOrigin];

  const serverResponse = (handler, url, options = {}) => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const contentType = options.body instanceof FormData ? "multipart/form-data" : options.headers?.["Content-Type"] || options.headers?.["content-type"];
    const request = new (class extends EventEmitter {})();
    const response = Object.assign(new ServerResponse(request), {
      assignSocket(socket) {},
      detachSocket(socket) {},
      writeHead() { return this; },
      flushHeaders() {},
    });
    const chunks = [];
    response.write = (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; };
    response.end = (chunk) => {
      if (chunk !== undefined) response.write(chunk);
      const body = Buffer.concat(chunks);
      const headers = response.getHeaders();
      resolve({
        status: response.statusCode,
        statusText: http.STATUS_CODES[response.statusCode] || "",
        headers: new Headers(Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : String(value)]))),
        ok: response.statusCode >= 200 && response.statusCode < 300,
        text: async () => body.toString("utf8"),
        json: async () => JSON.parse(body.toString("utf8")),
      });
      return response;
    };
    Object.assign(request, {
      method: options.method || "GET",
      url: `${parsed.pathname}${parsed.search}`,
      originalUrl: `${parsed.pathname}${parsed.search}`,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      headers: Object.fromEntries(Object.entries(options.headers || {}).map(([name, value]) => [name.toLowerCase(), value])),
      rawHeaders: Object.entries(options.headers || {}).flatMap(([name, value]) => [name, value]),
      body: undefined,
      cookies: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get(name) { return this.headers[String(name).toLowerCase()]; },
      header(name) { return this.get(name); },
      acceptsLanguages: () => "en",
      pipe(destination) { return destination; },
      resume() { return this; },
    });
    const dispatch = async () => {
      let content = options.body;
      if (content instanceof FormData) {
        const formResponse = new Response(content);
        request.headers["content-type"] = formResponse.headers.get("content-type");
        request.rawHeaders = [...request.rawHeaders.filter((value, index) => index % 2 === 0 || !String(value).toLowerCase().startsWith("content-type")), "content-type", formResponse.headers.get("content-type")];
        content = Buffer.from(await formResponse.arrayBuffer());
      }
      if (contentType && !(options.body instanceof FormData)) request.headers["content-type"] = contentType;
      request.body = typeof content === "string" && request.headers["content-type"]?.includes("application/json") ? JSON.parse(content) : undefined;
      try { handler(request, response, (error) => error ? reject(error) : response.status(404).end()); }
      catch (error) { reject(error); }
      if (content) {
        request.emit("data", Buffer.isBuffer(content) ? content : Buffer.from(String(content)));
        request.emit("end");
      }
    };
    dispatch();
  });
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  mock.method(globalThis, "fetch", (input, options = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const origin = new URL(url).origin;
    const handler = origin === adminOrigin ? admin : origin === pagesOrigin ? hosted : null;
    return handler ? serverResponse(handler, url, options) : originalFetch(input, options);
  });
  mock.method(http, "request", (options, callback) => {
    const port = typeof options === "object" ? options.port : Number(new URL(options).port);
    const handler = port === adminServer.address().port ? admin : hosted;
    const request = new (class extends EventEmitter {})();
    Object.assign(request, {
      method: options.method || "GET",
      url: options.path,
      originalUrl: options.path,
      path: options.path,
      query: {},
      headers: Object.fromEntries(Object.entries(options.headers || {}).map(([name, value]) => [name.toLowerCase(), value])),
      rawHeaders: Object.entries(options.headers || {}).flatMap(([name, value]) => [name, value]),
      body: undefined,
      cookies: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get(name) { return this.headers[String(name).toLowerCase()]; },
      header(name) { return this.get(name); },
      acceptsLanguages: () => "en",
      pipe(destination) { return destination; },
      resume() { return this; },
      end(body) { if (body) this.emit("data", Buffer.from(String(body))); this.emit("end"); return this; },
      destroy() { return this; },
      on(event, listener) { return super.on(event, listener); },
    });
    const response = Object.assign(new ServerResponse(request), {
      assignSocket(socket) {},
      detachSocket(socket) {},
      writeHead() { return this; },
      flushHeaders() {},
      setEncoding() {},
      destroy() {},
    });
    const chunks = [];
    response.write = (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; };
    response.end = (chunk) => {
      if (chunk !== undefined) response.write(chunk);
      const incoming = new EventEmitter();
      Object.assign(incoming, {
        statusCode: response.statusCode,
        headers: response.getHeaders(),
        resume() {},
        setEncoding() {},
        destroy() {},
        on(event, listener) { if (event === "data") { for (const item of chunks) listener(item); } else if (event === "end") setImmediate(listener); return this; },
      });
      callback?.(incoming);
      response.emit("finish");
      return response;
    };
    setImmediate(() => handler(request, response, (error) => error ? request.emit("error", error) : response.status(404).end()));
    return request;
  });
  t.after(async () => {
    mock.restoreAll();
    await Promise.all([
      new Promise((resolve) => adminServer.close(resolve)),
      new Promise((resolve) => pagesServer.close(resolve)),
    ]);
    db.close();
    await fs.promises.rm(directory, { recursive: true, force: true });
  });
  return { admin: adminOrigin, pages: pagesOrigin, adminServer, pagesServer, db, config };
}

function seedLegacy(db, directory, { id, title, slug, accessMode = "public" }) {
  const release = path.join(directory, "storage", "sites", id);
  fs.mkdirSync(release, { recursive: true });
  fs.writeFileSync(path.join(release, "index.html"), `<h1>${title}</h1>`);
  db.prepare("INSERT INTO pages (id,title,slug,entry_file,access_mode,source_type,original_filename,release_id,release_dir,size_bytes,file_count,created_at,updated_at,access_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)")
    .run(id, title, slug, "index.html", accessMode, "html", "index.html", "1-aaaaaaaaaa", release, 100, 1, "2026-01-01", "2026-01-02");
}

function seedWorkspace(db, directory) {
  db.exec(`INSERT INTO users(id,email,password_hash,email_verified_at,created_at) VALUES ('owner','lin@example.org','hash',1,1);
    INSERT INTO workspaces VALUES ('team','Field studio','team','owner','now');
    INSERT INTO workspace_members VALUES ('team','owner','owner','now');
    INSERT INTO workspace_page_ids VALUES ('${WORKSPACE_ID}');
    INSERT INTO workspace_pages VALUES ('${WORKSPACE_ID}','team','owner','Signal archive','private','${WORKSPACE_ID}','1-aaaaaaaaaa','index.html','html','index.html',10,1,'2026-01-01','2026-01-02');
    INSERT INTO workspace_page_revisions VALUES ('${WORKSPACE_ID}',0);
    INSERT INTO workspace_page_visibility VALUES ('${WORKSPACE_ID}');`);
  const release = path.join(directory, "workspace-storage", "sites", WORKSPACE_ID, "releases", "1-aaaaaaaaaa");
  fs.mkdirSync(release, { recursive: true });
  fs.writeFileSync(path.join(release, "index.html"), "<h1>Signal archive</h1>");
  fs.writeFileSync(path.join(release, "app.css"), "body{}");
}

test("public directory is the homepage and lists real applications with visit totals", async (t) => {
  const app = await setup(t);
  seedLegacy(app.db, app.config.dataDir, { id: "legacy-public", title: "Atlas field notes", slug: "atlas" });
  seedLegacy(app.db, app.config.dataDir, { id: "legacy-private", title: "Private review", slug: "review", accessMode: "private" });

  const home = await fetch(`${app.admin}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(await home.text(), /Hostlet/);
  assert.equal((await fetch(`${app.admin}/workspace`)).status, 200);
  assert.equal((await fetch(`${app.admin}/console`)).status, 200);

  const before = await (await fetch(`${app.admin}/api/public/apps`)).json();
  assert.equal(before.apps.length, 1);
  assert.equal(before.apps[0].id, "legacy-public");
  assert.equal(before.apps[0].visits, 0);
  assert.equal(before.apps[0].url, `${app.pages}/p/atlas/`);

  assert.equal((await fetch(`${app.pages}/p/atlas/`)).status, 200);
  assert.equal((await fetch(`${app.pages}/p/atlas/style.css`)).status, 404);
  assert.equal((await fetch(`${app.pages}/p/atlas/`, { method: "HEAD" })).status, 200);
  const after = await (await fetch(`${app.admin}/api/public/apps`)).json();
  assert.equal(after.apps[0].visits, 1);
  assert.equal(after.stats.visits, 1);
});

test("public directory paginates, sorts and searches while keeping global stats", async (t) => {
  const app = await setup(t);
  seedLegacy(app.db, app.config.dataDir, { id: "legacy-atlas", title: "Atlas field notes", slug: "atlas" });
  seedLegacy(app.db, app.config.dataDir, { id: "legacy-zephyr", title: "Zephyr index", slug: "zephyr" });
  assert.equal((await fetch(`${app.pages}/p/atlas/`)).status, 200);
  assert.equal((await fetch(`${app.pages}/p/atlas/`)).status, 200);

  const first = await (await fetch(`${app.admin}/api/public/apps?limit=1&offset=0`)).json();
  assert.equal(first.apps.length, 1);
  assert.equal(first.page.limit, 1);
  assert.equal(first.page.offset, 0);
  assert.equal(first.page.total, 2);
  assert.equal(first.page.hasMore, true);
  assert.equal(first.stats.applications, 2);
  assert.equal(first.stats.visits, 2);

  const second = await (await fetch(`${app.admin}/api/public/apps?limit=1&offset=1`)).json();
  assert.equal(second.apps.length, 1);
  assert.notEqual(second.apps[0].id, first.apps[0].id);
  assert.equal(second.page.hasMore, false);

  const popular = await (await fetch(`${app.admin}/api/public/apps?limit=2&sort=popular`)).json();
  assert.equal(popular.apps[0].id, "legacy-atlas");
  assert.equal(popular.apps[0].visits, 2);

  const search = await (await fetch(`${app.admin}/api/public/apps?q=zeph`)).json();
  assert.equal(search.apps.length, 1);
  assert.equal(search.apps[0].id, "legacy-zephyr");
  assert.equal(search.page.total, 1);
  assert.equal(search.stats.applications, 2);

  const none = await (await fetch(`${app.admin}/api/public/apps?q=missing`)).json();
  assert.equal(none.apps.length, 0);
  assert.equal(none.page.total, 0);
  assert.equal(none.stats.applications, 2);
});

test("public directory rejects malformed pagination and sort parameters", async (t) => {
  const app = await setup(t);
  for (const search of ["?limit=0", "?limit=49", "?limit=abc", "?offset=-1", "?offset=1000001", "?sort=unknown", `?q=${"x".repeat(121)}`]) {
    const response = await fetch(`${app.admin}/api/public/apps${search}`);
    assert.equal(response.status, 400, search);
    assert.equal((await response.json()).code, "INVALID_QUERY");
  }
});

test("public homepage serves language-specific SEO metadata", async (t) => {
  const app = await setup(t);
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const origin = escape(app.admin);

  const zhResponse = await fetch(`${app.admin}/`);
  assert.equal(zhResponse.headers.get("content-language"), "zh-CN");
  assert.match(zhResponse.headers.get("cache-control"), /no-cache/);
  const zh = await zhResponse.text();
  assert.match(zh, /<html lang="zh-CN">/);
  assert.ok(zh.includes(`<title>${publicCopy["zh-CN"].meta.title}</title>`));
  assert.match(zh, /<meta property="og:locale" content="zh_CN" \/>/);
  assert.match(zh, new RegExp(`<link rel="canonical" href="${origin}/" />`));
  assert.match(zh, new RegExp(`<meta property="og:image" content="${origin}/social-card.png" />`));

  const enResponse = await fetch(`${app.admin}/?lang=en`);
  assert.equal(enResponse.headers.get("content-language"), "en");
  const en = await enResponse.text();
  assert.match(en, /<html lang="en">/);
  assert.ok(en.includes(`<title>${publicCopy.en.meta.title.replaceAll("&", "&amp;")}</title>`));
  assert.match(en, /<meta property="og:locale" content="en_US" \/>/);
  assert.match(en, new RegExp(`<link rel="canonical" href="${origin}/\\?lang=en" />`));
  assert.match(en, /<meta name="twitter:card" content="summary_large_image" \/>/);
});

test("private and preview legacy requests do not count as public visits", async (t) => {
  const app = await setup(t);
  seedLegacy(app.db, app.config.dataDir, { id: "legacy-private", title: "Private review", slug: "review", accessMode: "private" });
  assert.equal((await fetch(`${app.pages}/p/review/`)).status, 401);
  const listing = await (await fetch(`${app.admin}/api/public/apps`)).json();
  assert.equal(listing.apps.length, 0);
  assert.equal(app.db.prepare("SELECT count(*) n FROM public_page_visits").get().n, 0);
});

test("public workspace application entry counts once and respects visibility", async (t) => {
  const app = await setup(t, {
    MULTIUSER_ENABLED: "true",
    SMTP_HOST: "smtp.example.test",
    SMTP_FROM: "noreply@example.test",
    ADMIN_ORIGIN: "https://manage.example.org",
    COOKIE_SECURE: "true",
    APPS_DOMAIN: "apps.example.test",
  });
  seedWorkspace(app.db, app.config.dataDir);

  const host = `${WORKSPACE_ID}.apps.example.test`;
  const request = (url, method = "GET") => fetch(`${app.pages}${url}`, { method, headers: { Host: host } });
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/app.css")).status, 200);
  assert.equal((await request("/", "HEAD")).status, 200);
  const listing = await (await fetch(`${app.admin}/api/public/apps`)).json();
  assert.equal(listing.apps.length, 1);
  assert.equal(listing.apps[0].visits, 1);
  assert.equal(listing.apps[0].url, `https://${host}/`);
  assert.equal(listing.apps[0].workspaceName, "Field studio");

  app.db.prepare("DELETE FROM workspace_page_visibility WHERE page_id=?").run(WORKSPACE_ID);
  assert.equal((await request("/")).status, 401);
  assert.equal((await (await fetch(`${app.admin}/api/public/apps`)).json()).apps.length, 0);
});
