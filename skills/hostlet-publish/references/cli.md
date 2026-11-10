# Hostlet CLI Reference

Use the CLI bundled with the skill at `<skill-dir>/bin/hostlet` (Windows: `<skill-dir>\bin\hostlet.ps1`; prefer it when arguments may contain spaces). Package page: <https://www.npmjs.com/package/hostlet-cli>. Source: <https://github.com/Revolves/hostlet/tree/master/cli>.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `HOSTLET_URL` | No | Management origin. Defaults to `https://hostlet.cn`. |
| `HOSTLET_TOKEN` | No | Optional 43-character API credential. Overrides the saved token. |
| `HOSTLET_CONFIG` | No | Optional credentials file path. Defaults to the user config directory. |
| `HOSTLET_SHARE_PASSWORD` | No | Optional share password; prefer `--password-stdin`. |

`register` and `login` save the account session and API token in the credentials file. Later commands use that saved token automatically. Only HTTPS is accepted for remote instances; HTTP is limited to loopback testing.

## Account Onboarding

Ask the user before creating an account or API key. Supply the password through standard input, not a command-line argument.

```powershell
$hostlet = "<skill-dir>\bin\hostlet.cmd"
& $hostlet register --username alice --password-stdin --json
& $hostlet login --identifier alice --password-stdin --json
& $hostlet whoami --json
& $hostlet logout --json
```

Registration and login create a 30-day API key with `read`, `publish`, and `share` scopes by default. Use `--no-key` to save only the session. The token is displayed once and saved locally; it cannot be retrieved again.

Use `--key-name`, `--scopes`, and `--expires` to customize the key. The password must contain at least 12 characters.

## API Keys

```powershell
& $hostlet keys list --json
& $hostlet keys create --key-name "CI publisher" --password-stdin --json
& $hostlet keys revoke --id KEY_ID --json
```

`keys create` asks for the account password again because the server re-authenticates credential creation. `keys list` and `keys revoke` use the saved account session.

## Discovery

```powershell
& $hostlet --help
& $hostlet --version
& $hostlet help publish
& $hostlet workspaces --json
& $hostlet pages --workspace WORKSPACE_ID --json
& $hostlet versions --workspace WORKSPACE_ID --page PAGE_ID --json
```

## Publish

```powershell
& $hostlet publish ./index.html --workspace WORKSPACE_ID --title "Site title" --json
& $hostlet publish ./site.zip --workspace WORKSPACE_ID --title "Site title" --entry index.html --json
& $hostlet publish ./dist --workspace WORKSPACE_ID --title "Site title" --json
```

Replace an existing application:

```powershell
& $hostlet publish ./dist --workspace WORKSPACE_ID --page PAGE_ID --revision 7 --json
```

`CONFLICT` means the application changed. Read its current revision before retrying. New applications are private; publishing does not make them public.

## Uncertain Results

The CLI prints the publication request ID to standard error before uploading.

```powershell
& $hostlet publish-status --workspace WORKSPACE_ID --request-id REQUEST_ID --json
```

- `not_found`: no committed receipt is visible yet. Retry only with the same request ID and identical content/options.
- `in_progress`: wait before checking again.
- `interrupted`: retry with the same request ID and identical content/options.
- `succeeded`: the historical request was committed. Inspect the application for its current state.

## Versions and Rollback

```powershell
& $hostlet versions --workspace WORKSPACE_ID --page PAGE_ID --json
& $hostlet rollback --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision 8 --json
```

## Private Shares

```powershell
& $hostlet share --workspace WORKSPACE_ID --page PAGE_ID --expires 2027-01-01T00:00:00Z --password-stdin --json
& $hostlet shares --workspace WORKSPACE_ID --page PAGE_ID --json
& $hostlet revoke-share --workspace WORKSPACE_ID --page PAGE_ID --share SHARE_ID --json
```

A new share link is displayed once. After a network error or 5xx response, list existing shares before trying again.
