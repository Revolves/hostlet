#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = path.dirname(fileURLToPath(import.meta.url));
const managed = ["SKILL.md", "agents", "references"];
const cliPackageName = "hostlet-cli";

function usage() {
  return `Usage: hostlet-skill [install] [options]

Install the Hostlet Publish agent skill and its isolated Hostlet CLI.

Options:
  --target <dir>       Skill directory to write (default: $CODEX_HOME/skills/hostlet-publish)
  --cli-version <ver>  Hostlet CLI version to install (default: the skill's pinned dependency)
  --skip-cli           Do not install the bundled CLI runtime
  -h, --help           Show this help
  -v, --version        Show the package version

The installer writes an isolated CLI under <target>/runtime and wrappers under
<target>/bin, so the skill works without a global npm install.

Examples:
  npx hostlet-skill install
  npx hostlet-skill install --target ./.codex/skills/hostlet-publish
  npx hostlet-skill install --skip-cli`;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a value.`);
  return value;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function packageVersion() {
  return (await readJson(path.join(source, "package.json"))).version;
}

function packageTarget(root, name) {
  return path.join(root, ...name.split("/"));
}

function resolvePackageDirectory(name, fromFile) {
  const require = createRequire(fromFile);
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    const entry = require.resolve(name);
    let current = path.dirname(entry);
    while (current !== path.dirname(current)) {
      try {
        const manifest = JSON.parse(require("node:fs").readFileSync(path.join(current, "package.json"), "utf8"));
        if (manifest.name === name) return current;
      } catch {
        // Keep walking until the package root is found.
      }
      current = path.dirname(current);
    }
    throw new Error(`Cannot resolve the ${name} package.`);
  }
}

async function localCliDirectory() {
  const candidate = path.resolve(source, "..", "..", "cli");
  try {
    const root = await readJson(path.resolve(source, "..", "..", "package.json"));
    const manifest = await readJson(path.join(candidate, "package.json"));
    if (root.name === "hostlet" && manifest.name === cliPackageName) return candidate;
  } catch {
    // Not running from a source checkout.
  }
  return null;
}

async function installedCliDirectory() {
  try {
    return resolvePackageDirectory(cliPackageName, path.join(source, "package.json"));
  } catch {
    return null;
  }
}

async function dependencyClosure(cliDirectory) {
  const packages = new Map();
  const queue = [cliDirectory];
  while (queue.length) {
    const directory = queue.shift();
    const manifest = await readJson(path.join(directory, "package.json"));
    if (typeof manifest.name !== "string" || packages.has(manifest.name)) continue;
    packages.set(manifest.name, directory);
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      try {
        queue.push(resolvePackageDirectory(dependency, path.join(directory, "package.json")));
      } catch (error) {
        throw new Error(`Cannot bundle ${manifest.name}: ${error.message}`);
      }
    }
  }
  return packages;
}

function copyFilter(file) {
  const name = path.basename(file);
  return name !== "node_modules" && name !== ".bin";
}

async function copyPackage(directory, targetRoot, name) {
  const destination = packageTarget(path.join(targetRoot, "node_modules"), name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(directory, destination, {
    recursive: true,
    force: true,
    dereference: true,
    filter: copyFilter,
  });
}

async function installFromDirectory(cliDirectory, runtime) {
  const packages = await dependencyClosure(cliDirectory);
  for (const [name, directory] of packages) await copyPackage(directory, runtime, name);
  return packages.get(cliPackageName);
}

function runNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => stdout += value);
    child.stderr.on("data", (value) => stderr += value);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`npm exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

async function installFromNpm(runtime, version) {
  const spec = version ? `${cliPackageName}@${version}` : cliPackageName;
  await fs.mkdir(runtime, { recursive: true });
  await runNpm([
    "install",
    "--prefix", runtime,
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    spec,
  ], runtime);
  const directory = packageTarget(path.join(runtime, "node_modules"), cliPackageName);
  await fs.access(path.join(directory, "hostlet.js"));
  return directory;
}

async function writeWrappers(target) {
  const bin = path.join(target, "bin");
  await fs.mkdir(bin, { recursive: true });
  const posix = `#!/bin/sh\nexec node "$(dirname "$0")/../runtime/node_modules/hostlet-cli/hostlet.js" "$@"\n`;
  const cmd = `@echo off\r\nnode "%~dp0..\\runtime\\node_modules\\hostlet-cli\\hostlet.js" %*\r\n`;
  const powershell = `#!/usr/bin/env pwsh\n$script = "$PSScriptRoot/../runtime/node_modules/hostlet-cli/hostlet.js"\nif ($MyInvocation.ExpectingInput) { $input | & node $script @args }\nelse { & node $script @args }\nexit $LASTEXITCODE\n`;
  await fs.writeFile(path.join(bin, "hostlet"), posix);
  await fs.writeFile(path.join(bin, "hostlet.cmd"), cmd);
  await fs.writeFile(path.join(bin, "hostlet.ps1"), powershell);
  try {
    await fs.chmod(path.join(bin, "hostlet"), 0o755);
    await fs.chmod(path.join(bin, "hostlet.ps1"), 0o755);
  } catch {
    // Windows does not expose POSIX modes.
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "install";
  if (args.includes("-h") || args.includes("--help") || command === "help") {
    console.log(usage());
    return;
  }
  if (args.includes("-v") || args.includes("--version")) {
    console.log(await packageVersion());
    return;
  }
  if (command !== "install") throw new Error(`Unknown command: ${command}`);

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const requested = readOption(args, "--target");
  const cliVersion = readOption(args, "--cli-version");
  const skipCli = args.includes("--skip-cli");
  const target = path.resolve(requested || path.join(codexHome, "skills", "hostlet-publish"));
  if (target === path.resolve(source)) throw new Error("Target must differ from the package source directory.");

  await fs.mkdir(target, { recursive: true });
  for (const name of managed) {
    await fs.cp(path.join(source, name), path.join(target, name), { recursive: true, force: true });
  }

  let cliPath = null;
  if (!skipCli) {
    const runtime = path.join(target, "runtime");
    await fs.rm(runtime, { recursive: true, force: true });
    await fs.mkdir(runtime, { recursive: true });
    const installed = cliVersion ? null : await localCliDirectory() || await installedCliDirectory();
    try {
      if (installed) cliPath = await installFromDirectory(installed, runtime);
      else cliPath = await installFromNpm(runtime, cliVersion);
    } catch (error) {
      await fs.rm(runtime, { recursive: true, force: true });
      throw new Error(`The skill was installed, but its CLI runtime could not be prepared. ${error.message} Re-run with --skip-cli only if hostlet is already available on PATH.`);
    }
    await writeWrappers(target);
  }

  console.log(`Installed Hostlet Publish skill at ${target}`);
  if (cliPath) {
    console.log(`Bundled Hostlet CLI: ${path.join(target, "bin", process.platform === "win32" ? "hostlet.cmd" : "hostlet")}`);
    console.log("Use the bundled CLI from the skill; no global npm install is required.");
  } else {
    console.log("Bundled CLI skipped. Install it with: npm install -g hostlet-cli");
  }
  console.log("Start a new agent session to load the skill.");
}

main().catch((error) => {
  console.error(`hostlet-skill: ${error.message}`);
  process.exitCode = 1;
});
