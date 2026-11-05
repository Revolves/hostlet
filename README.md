# Hostlet

## Your website, your call

Your website belongs to more than any one product.

An open-source platform for hosting and sharing static frontend applications, with personal and team workspaces. It uses Express, SQLite and a React/Vite workspace interface. The original single-administrator mode is also available.

The multiuser implementation is under development and requires deployment and security acceptance before public use. See [Chinese quick start](README.zh-CN.md) and [deployment guidance](docs/deployment.md).

Hostlet is open source under the [MIT License](LICENSE).

## Run

Requires Node.js 22.13 or later.

```sh
npm ci
```

Copy `.env.example` to `.env`. Set `ADMIN_PASSWORD` and a random `APP_SECRET` of at least 32 characters. The example values are rejected at startup. Generate a secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm start
```

- Public site: http://localhost:3000
- Workspace: http://localhost:3000/workspace (account workspace in multiuser mode, page manager in single-admin mode)
- Page-management workspace: http://localhost:3000/console
- Platform administration: http://localhost:3000/platform-admin (multiuser hosting only)
- Hosted pages: http://localhost:8080/p/example/
- Development: `npm run dev`, then http://localhost:5173
- Verification: `npm test` and `npm run build`

## Publish

The platform interface supports Simplified Chinese and English. It initially follows the browser language; the language switch on the login screen and management header remembers your choice. Platform-owned private-access and not-found screens also support both languages. Uploaded HTML content is never translated or branded by the platform.

Sign in with the configured administrator password. Choose Upload page, upload an HTML file or ZIP, set its title, mount slug, HTML entry file, and public/private access, then publish.

ZIP archives may contain the entry at their root or within one enclosing folder. Use relative asset URLs such as `assets/style.css`, and relative links between pages. Root-relative URLs such as `/assets/style.css` do not point inside a mounted site. This hosts static files; it does not execute server-side code or provide SPA fallback routing.

Page settings support editing, replacement releases, version history, rollback, previews, copying links, and deletion. Replacing a release preserves the mount path. Changing its slug breaks the previous URL. Preview links expire after 15 minutes; changing the active release invalidates its previous grants, including if an earlier version is restored. Stored versions count towards the storage statistic. Single-admin legacy pages do not automatically prune history; monitor disk usage. Workspace applications are capped at 20 retained versions and provide explicit old-version deletion.

## CLI

The CLI is an independent package in [`cli/`](cli) and requires Node.js 22.13 or later. It has not been published to the public npm registry yet, and the package name and registry availability still need confirmation. Install it from this checkout or from a local tarball:

```sh
npm install -g ./cli
hostlet --help

npm pack ./cli
npm install -g ./hostlet-cli-0.1.0.tgz
```

Running from source remains supported with `node cli/hostlet.js ...` (or `npm run pack:cli` to build the tarball).

Create a 30-day API credential with read, publish, and share scopes, then set `HOSTLET_URL` and `HOSTLET_TOKEN` in the environment. Do not commit the token or write it to logs.

```sh
hostlet workspaces
hostlet pages --workspace WORKSPACE_ID
hostlet versions --workspace WORKSPACE_ID --page PAGE_ID
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo"
hostlet publish-status --workspace WORKSPACE_ID --request-id REQUEST_ID
hostlet rollback --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet shares --workspace WORKSPACE_ID --page PAGE_ID
hostlet share --workspace WORKSPACE_ID --page PAGE_ID --expires 2027-01-01T00:00:00Z --password-stdin
hostlet revoke-share --workspace WORKSPACE_ID --page PAGE_ID --share SHARE_ID
```

`hostlet --help` lists every command. `hostlet help publish` or `hostlet publish --help` shows command options, and `hostlet --version` prints the package version. Help and version work without credentials. See [`cli/README.md`](cli/README.md) for installation, credential scopes, JSON output, and recovery details.

Publishing accepts HTML, ZIP, or a directory and creates a private application by default. Rollback requires the current revision; a `CONFLICT` response means the application changed and must be refreshed. A credential must include the `share` scope to list, create, or revoke shares. Share passwords can be supplied through `HOSTLET_SHARE_PASSWORD` or `--password-stdin`, and `--expires` accepts a future ISO-8601 time. A newly created share link is shown only once. After a network error or 5xx response, list existing shares before retrying because a created link cannot be recovered. Only HTTPS is accepted for remote instances; HTTP is limited to loopback testing.

## Multiuser development

The multiuser features are under development and are disabled by default. Set `MULTIUSER_ENABLED=true`, configure the SMTP settings in `.env.example`, and set `REGISTRATION_ENABLED=true` to enable account registration. SMTP requires TLS or STARTTLS. Set `ADMIN_ORIGIN` to the exact externally visible management origin and `COOKIE_SECURE=true` for HTTPS. Account links and team invitations use that origin. User accounts and workspaces are separate from the existing administrator account and its pages; existing pages are not automatically assigned to a user.

Workspace hosting can be enabled with `APPS_DOMAIN` and wildcard DNS/HTTPS, routed to the pages service with the original Host header. Use a different registrable domain for the management service. Applications default to private; editors can make them public or create revocable, optionally password-protected share links. Workspace quotas and administrative suspension are available. Each application may retain up to 20 versions, including the current version; editors can delete old versions to make room. Interrupted version deletion is retried at startup, and pending files remain charged against storage quota. Administrators can select long-term retention or inactivity cleanup with advance email notification; the default is long-term. Verified account holders can delete their account after confirming the current password; personal applications are removed, team applications remain with the team, sessions are revoked, and the account is retained only as a pseudonymous foreign-key tombstone. The last owner of a team must transfer ownership first. Account deletion records a durable task; if cleanup is interrupted, startup resumes it before serving requests. An explicit offline workflow migrates selected legacy pages to a verified account; see [legacy migration](docs/legacy-migration.md). This implementation requires further real HTTPS, SMTP, proxy and deployment verification before exposing it to untrusted users. Startup recovers recorded interrupted uploads and publications; older unrecorded leftovers and empty files or directories created before a recovery record require careful manual inspection. See [deployment guidance](docs/deployment.md) for the recovery boundaries.

For workspace ZIP uploads, leave the entry path blank to detect a single HTML entry. If several are found, select one and upload again; alternatively enter a known HTML path explicitly. At most 200 candidates and 64 KiB of candidate paths are offered for selection; larger sets require an explicit entry path. Workspace apps have their own domain root. A subdirectory containing `index.html` can be opened at its trailing-slash URL; SPA fallback routing is not provided. Applications execute in visitors' browsers, so private keys must not be included in uploaded files.

Private pages use the same configured host password as administrator login. This mode is intended for the administrator's own access: sharing that password also grants administrator access. Private resource URLs contain signed bearer grants valid for seven days after page login; anyone holding that URL can access that release until expiry. Uploaded pages run inside a CSP sandbox without `allow-same-origin`; browser storage and some origin-dependent scripts are therefore unavailable.

## Storage and limits

SQLite metadata, sessions, and audit records are stored in `data/hostlet.sqlite`. Published files live under `data/storage/sites/<id>/releases/`. Back up the whole data directory and `.env` together while the service is stopped. Keep the same absolute storage location when restoring because release paths are recorded in SQLite.

Sanitized HTTP security events are written under `data/security-logs/` by default, with UTC daily rotation and a default 180-day retention. Configure `SECURITY_LOG_RETENTION_DAYS` and review [security logging](docs/security-logging.md) before public operation. These files never include request bodies, cookies, query strings, passwords or token-bearing URLs.

Default upload size: 50 MiB (`MAX_UPLOAD_BYTES`). ZIP limits: 4,000 entries including folders, 2,000 files, 25 MiB per extracted file, and 100 MiB total extracted content. ZIP64 is not supported. Archives must contain the configured entry. Unsafe paths are rejected.

## Deployment

For the single-host container example and its verification limits, see [deployment](docs/deployment.md).

Use separate HTTPS hostnames for administration and uploaded content, preferably on separate registrable domains. Route the admin hostname to port 3000 and the content hostname to port 8080. Do not expose the admin API on the content hostname. Set `PUBLIC_BASE_URL`, `ADMIN_ORIGIN`, and `ADMIN_ORIGINS` to the actual addresses, and `COOKIE_SECURE=true` under HTTPS. Preserve the hosted content's CSP and MIME headers. Keep grant URLs out of proxy access logs, and disable shared caching for private content.

By default the app does not trust forwarded client addresses. When using a reverse proxy, configure `TRUSTED_PROXY_IPS` to the proxy's specific IPs or CIDRs and prevent direct access to backend ports. `.env`, `data/`, and generated build output are excluded from version control.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md); do not disclose them in public issues.
