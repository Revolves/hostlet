# Hostlet CLI Reference

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `HOSTLET_URL` | No | Management origin. Defaults to `https://hostlet.cn`. |
| `HOSTLET_TOKEN` | Yes | 43-character API credential with the required scope. |
| `HOSTLET_SHARE_PASSWORD` | No | Optional share password; prefer `--password-stdin`. |

Only HTTPS is accepted for remote instances. HTTP is limited to loopback testing.

## Discovery

```powershell
hostlet --help
hostlet --version
hostlet help publish
hostlet workspaces --json
hostlet pages --workspace WORKSPACE_ID --json
hostlet versions --workspace WORKSPACE_ID --page PAGE_ID --json
```

## Publish

```powershell
hostlet publish ./index.html --workspace WORKSPACE_ID --title "Site title" --json
hostlet publish ./site.zip --workspace WORKSPACE_ID --title "Site title" --entry index.html --json
hostlet publish ./dist --workspace WORKSPACE_ID --title "Site title" --json
```

Replace an existing application:

```powershell
hostlet publish ./dist --workspace WORKSPACE_ID --page PAGE_ID --revision 7 --json
```

`CONFLICT` means the application changed. Read its current revision before retrying.

## Uncertain Results

The CLI prints the publication request ID to standard error before uploading.

```powershell
hostlet publish-status --workspace WORKSPACE_ID --request-id REQUEST_ID --json
```

- `not_found`: no committed receipt is visible yet. Retry only with the same request ID and identical content/options.
- `in_progress`: wait before checking again.
- `interrupted`: retry with the same request ID and identical content/options.
- `succeeded`: the historical request was committed. Inspect the application for its current state.

## Versions and Rollback

```powershell
hostlet versions --workspace WORKSPACE_ID --page PAGE_ID --json
hostlet rollback --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision 8 --json
```

## Private Shares

```powershell
hostlet share --workspace WORKSPACE_ID --page PAGE_ID --expires 2027-01-01T00:00:00Z --password-stdin --json
hostlet shares --workspace WORKSPACE_ID --page PAGE_ID --json
hostlet revoke-share --workspace WORKSPACE_ID --page PAGE_ID --share SHARE_ID --json
```

A new share link is displayed once. After a network error or 5xx response, list existing shares before trying again.
