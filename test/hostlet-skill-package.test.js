import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env || process.env,
      shell: process.platform === "win32" && command === "npm",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => stdout += value);
    child.stderr.on("data", (value) => stderr += value);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("skill manifest is a standalone public npm package", async () => {
  const dir = path.join(process.cwd(), "skills", "hostlet-publish");
  const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
  assert.equal(pkg.name, "hostlet-skill");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.bin, { "hostlet-skill": "install.js" });
  assert.equal(pkg.repository.directory, "skills/hostlet-publish");
  assert.equal(pkg.publishConfig.access, "public");
  assert.deepEqual(pkg.dependencies, { "hostlet-cli": pkg.version });
  for (const file of ["install.js", "SKILL.md", "README.md", "LICENSE", "agents/openai.yaml", "references/cli.md"]) {
    await fs.access(path.join(dir, file));
  }
  const script = await fs.readFile(path.join(dir, "install.js"), "utf8");
  assert.match(script, /^#!\/usr\/bin\/env node/);
});

test("npm pack includes only the skill runtime and package docs", async (t) => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "hostlet-skill-pack-"));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const result = await run("npm", ["pack", "--dry-run", "--json", "./skills/hostlet-publish"], {
    env: {
      ...process.env,
      npm_config_cache: cache,
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const [summary] = JSON.parse(result.stdout);
  assert.equal(summary.name, "hostlet-skill");
  assert.deepEqual(summary.files.map((file) => file.path).sort(), [
    "LICENSE",
    "README.md",
    "SKILL.md",
    "agents/openai.yaml",
    "install.js",
    "package.json",
    "references/cli.md",
  ]);
});

test("installer copies the skill with an isolated CLI runtime", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "hostlet-skill-install-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const script = path.join(process.cwd(), "skills", "hostlet-publish", "install.js");

  const installed = await run(process.execPath, [script, "install", "--target", target]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.match(installed.stdout, /Installed Hostlet Publish skill/);
  assert.match(installed.stdout, /Bundled Hostlet CLI/);
  assert.match(installed.stdout, /no global npm install/);
  assert.match(await fs.readFile(path.join(target, "SKILL.md"), "utf8"), /name: hostlet-publish/);
  await fs.access(path.join(target, "agents", "openai.yaml"));
  await fs.access(path.join(target, "references", "cli.md"));
  await fs.access(path.join(target, "bin", "hostlet"));
  await fs.access(path.join(target, "bin", "hostlet.cmd"));
  await fs.access(path.join(target, "bin", "hostlet.ps1"));
  const cli = path.join(target, "runtime", "node_modules", "hostlet-cli", "hostlet.js");
  await fs.access(cli);
  await fs.access(path.join(target, "runtime", "node_modules", "jszip", "package.json"));
  const runtimeVersion = await run(process.execPath, [cli, "--version"]);
  assert.equal(runtimeVersion.code, 0, runtimeVersion.stderr);
  assert.match(runtimeVersion.stdout, /^hostlet-cli \d+\.\d+\.\d+/);

  const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), "skills", "hostlet-publish", "package.json"), "utf8"));
  const version = await run(process.execPath, [script, "--version"]);
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), pkg.version);
});

test("installer supports --skip-cli and documents bundled runtime options", async (t) => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "hostlet-skill-skip-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const script = path.join(process.cwd(), "skills", "hostlet-publish", "install.js");

  const help = await run(process.execPath, [script, "--help"]);
  assert.equal(help.code, 0, help.stderr);
  for (const text of ["--target", "--cli-version", "--skip-cli", "<target>/runtime", "<target>/bin"]) {
    assert.ok(help.stdout.includes(text), `installer help should mention ${text}`);
  }

  const installed = await run(process.execPath, [script, "install", "--target", target, "--skip-cli"]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.match(installed.stdout, /Bundled CLI skipped/);
  await fs.access(path.join(target, "SKILL.md"));
  await assert.rejects(fs.access(path.join(target, "runtime")));
  await assert.rejects(fs.access(path.join(target, "bin", "hostlet")));
});
