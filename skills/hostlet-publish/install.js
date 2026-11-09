#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.dirname(fileURLToPath(import.meta.url));
const managed = ["SKILL.md", "agents", "references"];

function usage() {
  return `Usage: hostlet-skill [install] [options]

Install the Hostlet Publish agent skill.

Options:
  --target <dir>  Skill directory to write (default: $CODEX_HOME/skills/hostlet-publish)
  -h, --help      Show this help
  -v, --version   Show the package version

Examples:
  npx hostlet-skill install
  npx hostlet-skill install --target ./.codex/skills/hostlet-publish`;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a directory.`);
  return value;
}

async function version() {
  const manifest = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"));
  return manifest.version;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "install";
  if (args.includes("-h") || args.includes("--help") || command === "help") {
    console.log(usage());
    return;
  }
  if (args.includes("-v") || args.includes("--version")) {
    console.log(await version());
    return;
  }
  if (command !== "install") throw new Error(`Unknown command: ${command}`);

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const requested = readOption(args, "--target");
  const target = path.resolve(requested || path.join(codexHome, "skills", "hostlet-publish"));
  if (target === path.resolve(source)) throw new Error("Target must differ from the package source directory.");

  await fs.mkdir(target, { recursive: true });
  for (const name of managed) {
    await fs.cp(path.join(source, name), path.join(target, name), { recursive: true, force: true });
  }

  console.log(`Installed Hostlet Publish skill at ${target}`);
  console.log("Install the CLI with: npm install -g hostlet-cli");
  console.log("Start a new agent session to load the skill.");
}

main().catch((error) => {
  console.error(`hostlet-skill: ${error.message}`);
  process.exitCode = 1;
});
