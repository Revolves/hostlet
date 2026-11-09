---
name: hostlet-publish
description: Publish and manage static HTML sites on Hostlet, including the official hostlet.cn service and self-hosted instances, through the Hostlet CLI. Use when the user asks to deploy, publish, replace, roll back, share, or inspect a Hostlet application.
---

# Hostlet Publish

Use the repository's `cli/hostlet.js` or an installed `hostlet` command. Do not reimplement the upload protocol.

## Destination

- Official service: leave `HOSTLET_URL` unset. The CLI defaults to `https://hostlet.cn`.
- Self-hosted service: set `HOSTLET_URL` to the instance's HTTPS management origin.
- Require `HOSTLET_TOKEN`, a 43-character API credential. Obtain it from the target instance's account portal with the `read`, `publish`, and optionally `share` scopes.
- Never use an administrator password as the token, print the token, write it to the repository, or include it in a command-line argument.
- If the target instance has no account credential flow or `/api/cli`, stop and explain that it cannot accept CLI publishing. Do not search for a bypass.

## Before Upload

Confirm from the request or existing context:

1. Target instance, workspace, source file or directory, and application title.
2. The exact source boundary. Do not upload parent directories, hidden files, `node_modules`, secrets, or build caches.
3. Whether this is a new application or a replacement. A replacement needs both `--page` and the current `--revision`.

New applications are private by default. This skill must not make an application public.

## Publish

```powershell
$env:HOSTLET_TOKEN = '...'
hostlet workspaces --json
hostlet publish ./dist --workspace WORKSPACE_ID --title "Site title" --json
```

For a custom instance:

```powershell
$env:HOSTLET_URL = 'https://hostlet.example.com'
$env:HOSTLET_TOKEN = '...'
hostlet workspaces --json
```

Use `--entry PATH` when a ZIP or directory contains multiple HTML entry files. Use `--page` and `--revision` only when replacing an existing application.

## Confirm the Result

- Treat a successful CLI exit and a returned page ID as the publication result.
- If the network or server response is uncertain, do not send a new publication blindly. Run `publish-status` with the printed request ID, then retry only with the same request ID and unchanged content if needed.
- Report the application ID, title, workspace, revision, and private access state. Do not report a public URL unless another authorized step changed visibility.

## More Detail

Read [references/cli.md](references/cli.md) for all commands, replacement rules, sharing, rollback, and recovery behavior.
