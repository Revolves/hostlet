---
name: hostlet-publish
description: Publish and manage static HTML sites on Hostlet, including the official hostlet.cn service and self-hosted instances. Use when the user asks to register, sign in, create an API key, deploy, publish, replace, roll back, share, or inspect a Hostlet application.
---

# Hostlet Publish

Use the CLI bundled with this skill. Do not reimplement the upload protocol.

Source and documentation: <https://github.com/Revolves/hostlet/tree/master/skills/hostlet-publish>.

## Bundled CLI

The installer places an isolated CLI runtime beside this file:

- Windows: `<skill-dir>\bin\hostlet.ps1`
- macOS/Linux: `<skill-dir>/bin/hostlet`

`<skill-dir>` is the directory containing this `SKILL.md`, normally `$CODEX_HOME/skills/hostlet-publish`. Use the absolute path to that wrapper. On Windows, prefer `hostlet.ps1` when arguments may contain spaces; a `.cmd` wrapper can lose quoting when an agent launches it through an extra shell. Do not assume that `hostlet` is on `PATH` and do not install a second global copy unless the bundled wrapper is missing.

If the wrapper is missing, reinstall with `npx hostlet-skill install`. To follow the newest published CLI explicitly, use `npx hostlet-skill@latest install --cli-version latest`; the default pinned CLI keeps a skill release reproducible. In a source checkout, `node cli/hostlet.js` remains a development fallback.

## Account Setup

The CLI can register, sign in, create an API key, and then publish. Always ask the user for permission and for the account details before creating an account or API key. Never choose a password for the user.

Create a username account and save an API key in one flow:

```powershell
& "<skill-dir>\bin\hostlet.cmd" register --username alice --password-stdin
```

Sign in to an existing username or email account:

```powershell
& "<skill-dir>\bin\hostlet.cmd" login --identifier alice --password-stdin
```

Supply the password through the child process's standard input. Never put the password in a command-line argument, a shell variable that will be echoed, a log, or a file. The account password must contain at least 12 characters.

`register` and `login` save the account session and, unless `--no-key` is used, create an API key with `read`, `publish`, and `share` scopes valid for 30 days. The token is shown once and is also saved in the Hostlet credentials file. Later commands read it automatically; do not ask the user to set `HOSTLET_TOKEN` again.

Manage keys with:

```powershell
& "<skill-dir>\bin\hostlet.cmd" keys list
& "<skill-dir>\bin\hostlet.cmd" keys create --key-name "Agent publisher" --password-stdin
& "<skill-dir>\bin\hostlet.cmd" keys revoke --id KEY_ID
& "<skill-dir>\bin\hostlet.cmd" whoami
& "<skill-dir>\bin\hostlet.cmd" logout
```

`keys create` and `keys revoke` use the saved account session. Creating a key asks for the account password again through standard input.

The credentials file is stored in the user configuration directory, or at `HOSTLET_CONFIG` when that variable is set. Do not read, print, copy, or commit it. `HOSTLET_TOKEN` is still supported for automation and takes precedence over the saved token.

## Destination

- Official service: leave `HOSTLET_URL` unset. The CLI defaults to `https://hostlet.cn`.
- Self-hosted service: set `HOSTLET_URL` to the instance's HTTPS management origin.
- Never use an administrator password as an API token, print a token, or write one to the repository.
- If the target instance has no account credential flow or `/api/cli`, stop and explain that it cannot accept CLI publishing. Do not search for a bypass.

## Before Upload

Confirm from the request or existing context:

1. Target instance, workspace, source file or directory, and application title.
2. The exact source boundary. Do not upload parent directories, hidden files, `node_modules`, secrets, or build caches.
3. Whether this is a new application or a replacement. A replacement needs both `--page` and the current `--revision`.

New applications are private by default. Only change visibility when the user explicitly asks for a public address.

## Publish

```powershell
$hostlet = "<skill-dir>\bin\hostlet.cmd"
& $hostlet workspaces --json
& $hostlet publish ./dist --workspace WORKSPACE_ID --title "Site title" --json
```

For a custom instance:

```powershell
$env:HOSTLET_URL = 'https://hostlet.example.com'
& $hostlet workspaces --json
```

Use `--entry PATH` when a ZIP or directory contains multiple HTML entry files. Use `--page` and `--revision` only when replacing an existing application.

If the user has no account yet, run the account setup flow first, then `workspaces`, then publish. If the account exists but has no saved key, run `keys create --password-stdin`.

## Visibility

```powershell
& $hostlet visibility public --workspace WORKSPACE_ID --page PAGE_ID --json
& $hostlet visibility private --workspace WORKSPACE_ID --page PAGE_ID --json
```

Public applications are reachable by anyone with the address, so confirm with the owner before switching. Team workspaces require the owner role. After a successful change, report the state and point the owner to the public link shown on the application card in the account portal.

## Manage an application

```powershell
& $hostlet rename --workspace WORKSPACE_ID --page PAGE_ID --title "New title" --json
& $hostlet delete-release --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION --json
& $hostlet delete-app --workspace WORKSPACE_ID --page PAGE_ID --confirm --json
```

`rename` changes the title shown in the portal and the public directory. `delete-release` permanently drops one retained version and needs the current revision; the active release must be switched first. `delete-app` permanently removes the application, every release and its public address, so confirm with the owner and pass `--confirm`; there is no undo. All three require the `publish` scope, and application deletion needs a personal workspace or the owner role.

## Confirm the Result

- Treat a successful CLI exit and a returned page ID as the publication result.
- If the network or server response is uncertain, do not send a new publication blindly. Run `publish-status` with the printed request ID, then retry only with the same request ID and unchanged content if needed.
- Report the application ID, title, workspace, revision, and private access state. Do not report a public URL unless another authorized step changed visibility.

## More Detail

Read [references/cli.md](references/cli.md) for all commands, replacement rules, sharing, rollback, and recovery behavior.
