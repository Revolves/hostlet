# hostlet-cli

Publish and manage static applications on [Hostlet](https://hostlet.cn) or a self-hosted instance.

## Status

Published on npm as [`hostlet-cli`](https://www.npmjs.com/package/hostlet-cli). The source lives in the [Hostlet GitHub repository](https://github.com/Revolves/hostlet/tree/master/cli).

## Requirements

- Node.js 22.13.0 or later.

## Install

Install globally from npm:

```sh
npm install -g hostlet-cli
hostlet --help
```

Or run it without a global install:

```sh
npx hostlet-cli --help
```

For development, install from a checkout:

```sh
git clone https://github.com/Revolves/hostlet.git
cd hostlet
npm install
node cli/hostlet.js --help
```

Running from a packed tarball remains supported:

```sh
npm pack ./cli
npm install -g ./hostlet-cli-0.1.0.tgz
```

## Source and issues

- Repository: <https://github.com/Revolves/hostlet>
- CLI source: <https://github.com/Revolves/hostlet/tree/master/cli>
- Issues: <https://github.com/Revolves/hostlet/issues>
- Agent skill: [`hostlet-skill`](https://www.npmjs.com/package/hostlet-skill)

## Configuration

Create a 30-day API credential in the Hostlet account portal with the `read`, `publish`, and `share` scopes. Then set:

| Variable | Required | Description |
| --- | --- | --- |
| `HOSTLET_URL` | No | Management origin. Defaults to `https://hostlet.cn`; set it for a custom instance. |
| `HOSTLET_TOKEN` | Yes | 43-character API credential. Never pass it as a command-line argument. |
| `HOSTLET_SHARE_PASSWORD` | No | Share password. Prefer `--password-stdin` to keep it out of the environment and shell history. |

PowerShell:

```powershell
$env:HOSTLET_TOKEN = '...'
hostlet workspaces
```

Custom instance:

```powershell
$env:HOSTLET_URL = 'https://hostlet.example.com'
$env:HOSTLET_TOKEN = '...'
hostlet workspaces
```

Only HTTPS is accepted for remote instances. HTTP is allowed only for `localhost`, `127.0.0.1`, and `[::1]` loopback testing. The CLI does not read a token from a file or prompt for one. The target instance must expose the account API credential flow and `/api/cli`; using an administrator password as `HOSTLET_TOKEN` is not supported.

## Commands

| Command | Purpose | Credential scope |
| --- | --- | --- |
| `workspaces` | List workspaces available to the credential. | `read` |
| `pages` | List applications in a workspace. | `read` |
| `versions` | List retained releases of an application. | `read` |
| `publish` | Publish a new private application or replace an existing release. | `publish` |
| `publish-status` | Check an earlier publication request. | `read` or `publish` |
| `rollback` | Activate a retained release as the current version. | `publish` |
| `shares` | List share-link metadata. | `share` |
| `share` | Create a revocable share link. | `share` |
| `revoke-share` | Revoke a share link immediately. | `share` |

```sh
hostlet --help
hostlet help publish
hostlet publish --help
hostlet --version
```

Help and version output work without `HOSTLET_URL` or `HOSTLET_TOKEN`.

## Publish

`publish` accepts an HTML file, a ZIP archive, or a directory. New applications are private by default; the CLI never makes an application public on its own.

```sh
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo"
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo" --json
hostlet publish ./site.zip --workspace WORKSPACE_ID --page PAGE_ID --revision 7 --entry index.html
```

Use `--entry PATH` when a ZIP contains more than one HTML entry. Directories must not contain hidden files, `node_modules`, or symbolic links. The CLI accepts files up to 100 MiB, but the server's `MAX_UPLOAD_BYTES` limit (50 MiB by default) may be lower.

When replacing an application, pass both `--page` and the current `--revision`. A `CONFLICT` response means the application changed; re-read it and retry with the latest revision.

## Unconfirmed results

An unconfirmed network response does not prove whether a publication succeeded. The CLI prints the request ID to standard error before uploading. If the result is unknown:

```sh
hostlet publish-status --workspace WORKSPACE_ID --request-id REQUEST_ID
```

- `succeeded`: the historical request was committed. Check the application for its current state.
- `in_progress`: wait and query again.
- `interrupted`: retry with the same request ID and unchanged content.
- `not_found`: this does not prove the request will never arrive; retry with the same request ID.

To make a retry explicit, pass `--request-id ID` to `publish`. A request ID must contain 22-128 letters, digits, `_`, or `-`. Retry with the same file, filename, title, entry, target application, and revision; use a new request ID if any of those change.

## Shares

Share links require the `share` scope. A newly created link is printed once and cannot be recovered:

```sh
hostlet share --workspace WORKSPACE_ID --page PAGE_ID --expires 2027-01-01T00:00:00Z --password-stdin
hostlet shares --workspace WORKSPACE_ID --page PAGE_ID
hostlet revoke-share --workspace WORKSPACE_ID --page PAGE_ID --share SHARE_ID
```

After a network error or 5xx response during `share`, run `shares` before retrying. Do not paste share links or credentials into issue reports.

## Output and exit codes

With `--json`, successful results are written to standard output as a single JSON value. Progress, the publication request ID, and recovery guidance are written to standard error. Errors are written to standard error, are redacted when they contain the current token, and exit with code `1`. Help, version, and successful commands exit with code `0`.

## Security

- Keep `HOSTLET_TOKEN` out of command lines, shell history, logs, and source control.
- Use the narrowest credential scope that the task needs.
- Treat share links as bearer credentials. Revoke a link if it may have leaked.
- Hosted applications run in visitors' browsers, so never upload private keys or secrets.

## License

MIT
