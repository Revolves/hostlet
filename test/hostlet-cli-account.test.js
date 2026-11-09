import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const password = "correct horse battery staple";
const firstToken = "K".repeat(43);
const secondToken = "L".repeat(43);
const loginToken = "M".repeat(43);
const account = { id: "account-1", email: "alice@users.hostlet.invalid", username: "alice" };

function readBody(request) {
  return new Promise((resolve) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => value += chunk);
    request.on("end", () => resolve(value));
  });
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hostlet-cli-account-"));
  const config = path.join(dir, "credentials.json");
  const requests = [];
  let cookieName = "hostlet_account";
  let nextToken = firstToken;
  let keys = [];

  const server = http.createServer(async (request, response) => {
    const bodyText = await readBody(request);
    const body = bodyText ? JSON.parse(bodyText) : null;
    const record = {
      method: request.method,
      url: request.url,
      origin: request.headers.origin || null,
      cookie: request.headers.cookie || null,
      authorization: request.headers.authorization || null,
      body,
    };
    requests.push(record);
    const sendJson = (status, value, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(value));
    };
    const sendCookie = (status, value) => {
      sendJson(status, value, {
        "set-cookie": `${cookieName}=${"C".repeat(43)}; Path=/; HttpOnly; SameSite=Strict`,
      });
    };

    if (request.method === "POST" && request.url === "/api/account/register") {
      assert.equal(record.origin, base);
      assert.equal(body.username, "alice");
      assert.equal(body.password, password);
      return sendCookie(201, { account });
    }
    if (request.method === "POST" && request.url === "/api/account/login") {
      assert.equal(record.origin, base);
      assert.equal(body.identifier, "alice");
      assert.equal(body.password, password);
      return sendCookie(200, { account });
    }
    if (request.method === "POST" && request.url === "/api/account/logout") {
      assert.equal(record.origin, base);
      assert.match(record.cookie, new RegExp(`^${cookieName}=`));
      return sendJson(200, { authenticated: false });
    }
    if (request.method === "GET" && request.url === "/api/account/me") {
      assert.match(record.cookie, new RegExp(`^${cookieName}=`));
      return sendJson(200, { account });
    }
    if (request.method === "GET" && request.url === "/api/account/credentials") {
      assert.match(record.cookie, new RegExp(`^${cookieName}=`));
      return sendJson(200, { credentials: keys });
    }
    if (request.method === "POST" && request.url === "/api/account/credentials") {
      assert.match(record.cookie, new RegExp(`^${cookieName}=`));
      assert.equal(body.password, password);
      const key = {
        id: `key-${keys.length + 1}`,
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt,
        revokedAt: null,
        token: nextToken,
      };
      keys = [...keys, { ...key, token: undefined }];
      return sendJson(201, key);
    }
    if (request.method === "DELETE" && request.url.startsWith("/api/account/credentials/")) {
      assert.match(record.cookie, new RegExp(`^${cookieName}=`));
      const id = decodeURIComponent(request.url.split("/").at(-1));
      keys = keys.map((key) => key.id === id ? { ...key, revokedAt: Date.now() } : key);
      response.writeHead(204);
      return response.end();
    }
    if (request.method === "GET" && request.url === "/api/cli/workspaces") {
      assert.match(record.authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
      return sendJson(200, [{ id: "workspace-1", name: "Personal", role: "owner" }]);
    }
    return sendJson(404, { error: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  function run(args, { input, env = {} } = {}) {
    const childEnv = { ...process.env, HOSTLET_URL: base, HOSTLET_CONFIG: config, ...env };
    delete childEnv.HOSTLET_TOKEN;
    delete childEnv.HOSTLET_SHARE_PASSWORD;
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", "cli/hostlet.js", ...args], {
        cwd: process.cwd(),
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (value) => stdout += value);
      child.stderr.on("data", (value) => stderr += value);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input === undefined ? "" : input);
    });
  }

  return {
    dir,
    config,
    base,
    requests,
    run,
    setNextToken(token) { nextToken = token; },
    setCookieName(name) { cookieName = name; },
  };
}

test("CLI registers, saves credentials, manages keys, logs out and logs in again", async (t) => {
  const ctx = await fixture(t);

  const registered = await ctx.run(["register", "--username", "alice", "--password-stdin", "--json"], {
    input: `${password}\n`,
  });
  assert.equal(registered.code, 0, registered.stderr);
  assert.ok(!registered.stdout.includes(password), "stdout must not contain the account password");
  assert.ok(!registered.stderr.includes(password), "stderr must not contain the account password");
  const registration = JSON.parse(registered.stdout);
  assert.equal(registration.account.username, "alice");
  assert.equal(registration.credential.token, firstToken);
  assert.equal(registration.workspaces[0].id, "workspace-1");
  assert.equal(registration.configPath, ctx.config);

  const stored = JSON.parse(await fs.readFile(ctx.config, "utf8"));
  const entry = stored.instances[ctx.base];
  assert.equal(entry.token, firstToken);
  assert.match(entry.cookie, /^hostlet_account=/);
  assert.equal(JSON.stringify(stored).includes(password), false);

  const workspaces = await ctx.run(["workspaces", "--json"]);
  assert.equal(workspaces.code, 0, workspaces.stderr);
  assert.equal(JSON.parse(workspaces.stdout)[0].id, "workspace-1");
  assert.equal(ctx.requests.at(-1).authorization, `Bearer ${firstToken}`);

  const whoami = await ctx.run(["whoami", "--json"]);
  assert.equal(whoami.code, 0, whoami.stderr);
  assert.equal(JSON.parse(whoami.stdout).account.id, account.id);

  const listed = await ctx.run(["keys", "list", "--json"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).credentials.length, 1);
  assert.equal(JSON.parse(listed.stdout).credentials[0].token, undefined);

  ctx.setNextToken(secondToken);
  const created = await ctx.run(["keys", "create", "--key-name", "CI publisher", "--password-stdin", "--json"], {
    input: `${password}\n`,
  });
  assert.equal(created.code, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).token, secondToken);
  const afterCreate = JSON.parse(await fs.readFile(ctx.config, "utf8"));
  assert.equal(afterCreate.instances[ctx.base].token, secondToken);
  assert.equal(JSON.stringify(afterCreate).includes(password), false);

  const revoked = await ctx.run(["keys", "revoke", "--id", "key-2", "--json"]);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.deepEqual(JSON.parse(revoked.stdout), { revoked: true, id: "key-2" });

  const loggedOut = await ctx.run(["logout", "--json"]);
  assert.equal(loggedOut.code, 0, loggedOut.stderr);
  const afterLogout = JSON.parse(await fs.readFile(ctx.config, "utf8"));
  assert.equal(Object.hasOwn(afterLogout.instances, ctx.base), false);

  const denied = await ctx.run(["workspaces", "--json"]);
  assert.notEqual(denied.code, 0);
  assert.match(denied.stderr, /No saved credential/);

  ctx.setNextToken(loginToken);
  const loggedIn = await ctx.run(["login", "--identifier", "alice", "--password-stdin", "--json"], {
    input: `${password}\n`,
  });
  assert.equal(loggedIn.code, 0, loggedIn.stderr);
  assert.equal(JSON.parse(loggedIn.stdout).credential.token, loginToken);
  assert.ok(!loggedIn.stdout.includes(password));
});

test("CLI rejects weak passwords before making a request and supports --no-key", async (t) => {
  const ctx = await fixture(t);
  const before = ctx.requests.length;
  const weak = await ctx.run(["register", "--username", "alice", "--password-stdin"], {
    input: "too short\n",
  });
  assert.notEqual(weak.code, 0);
  assert.match(weak.stderr, /at least 12 characters/);
  assert.equal(ctx.requests.length, before);

  const noKey = await ctx.run(["register", "--username", "alice", "--password-stdin", "--no-key", "--json"], {
    input: `${password}\n`,
  });
  assert.equal(noKey.code, 0, noKey.stderr);
  assert.equal(JSON.parse(noKey.stdout).credential, null);
  const stored = JSON.parse(await fs.readFile(ctx.config, "utf8"));
  assert.equal(stored.instances[ctx.base].token, undefined);
  assert.match(stored.instances[ctx.base].cookie, /^hostlet_account=/);
});
