# hostlet-skill

Agent skill for publishing static applications to [Hostlet](https://hostlet.cn). The installer bundles an isolated copy of [`hostlet-cli`](https://www.npmjs.com/package/hostlet-cli), so the skill works without a global CLI install.

## Install

```sh
npx hostlet-skill install
```

The installer writes the skill and its CLI runtime into `$CODEX_HOME/skills/hostlet-publish` by default:

```text
hostlet-publish/
  SKILL.md
  agents/
  references/
  runtime/node_modules/hostlet-cli/
  bin/hostlet
  bin/hostlet.cmd
  bin/hostlet.ps1
```

Use the bundled wrapper from the skill:

```powershell
& "$env:CODEX_HOME\skills\hostlet-publish\bin\hostlet.cmd" --version
```

Install into a project-local skills directory:

```sh
npx hostlet-skill install --target ./.codex/skills/hostlet-publish
```

From a source checkout:

```sh
node skills/hostlet-publish/install.js --target ./.agents/skills/hostlet-publish
```

Start a new agent session after installation so the skill is discovered.

## Zero to publish

The bundled CLI can register an account, create an API key, and publish:

```powershell
$hostlet = "$env:CODEX_HOME\skills\hostlet-publish\bin\hostlet.cmd"
& $hostlet register --username alice --password-stdin
& $hostlet workspaces --json
& $hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo" --json
```

Pass the password through standard input. Do not place it in a command-line argument, a log, or a file. Registration and login save the API token in the Hostlet credentials file; later commands read it automatically.

For an existing account:

```powershell
& $hostlet login --identifier alice --password-stdin
& $hostlet whoami
& $hostlet keys list
```

## Options

- `--target <dir>` writes to another skills directory.
- `--cli-version <ver>` installs a specific `hostlet-cli` version from npm instead of using the pinned dependency.
- `--skip-cli` copies only the skill files. Use this only when `hostlet` is already available on `PATH` or the environment is offline.

`HOSTLET_URL` defaults to `https://hostlet.cn`; set it for a self-hosted instance. `HOSTLET_TOKEN` is still supported for automation and overrides the saved token.

## Links

- GitHub: <https://github.com/Revolves/hostlet/tree/master/skills/hostlet-publish>
- npm: <https://www.npmjs.com/package/hostlet-skill>
- CLI: <https://www.npmjs.com/package/hostlet-cli>
- Issues: <https://github.com/Revolves/hostlet/issues>
