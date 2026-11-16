# Hostlet

**Language:** [简体中文](README.md) | English

## Your website, your call

Your website belongs to more than any one product.

An open-source platform for hosting and sharing static frontend applications, with personal and team workspaces. It uses Express, SQLite and a React/Vite workspace interface. Multiuser mode provides email or username accounts, personal and team workspaces, membership approval, HTML/ZIP/directory publishing, private access, revocable share links, version history and rollback, and API keys; the original single-administrator mode is also available. It hosts static files executed in visitors' browsers and does not run user server-side code, provide an application database, or offer SPA fallback routing.

Multiuser mode is implemented and runs on the official instance. Review the [deployment guidance](docs/deployment.md) and [security policy](SECURITY.md) and verify HTTPS, domains, email, isolation, backups and content governance before exposing a self-hosted instance to untrusted users.

Official instance: <https://hostlet.cn>. It runs single-domain multiuser hosting with username registration (`https://<app-id>.apps.hostlet.cn/`). Public showcase: <https://hostlet.cn/p/hostlet/>.

Current release status (2026-11-10): `hostlet-cli@0.2.3`, `hostlet-skill@0.2.6`; the latest full check passed 400 tests with 2 platform skips, and the production build passed 48 modules. See [project status](docs/project-status.md) for the canonical product, version and deployment summary.

Source, issues and releases: <https://github.com/Revolves/hostlet>. See [CHANGELOG.md](CHANGELOG.md) for release notes and [MIT License](LICENSE) for licensing.

## Run

Requires Node.js 22.13 or later.

```sh
npm ci
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in Windows PowerShell, `cp .env.example .env` on Linux/macOS). Set `ADMIN_PASSWORD` and a random `APP_SECRET` of at least 32 characters. The example values are rejected at startup. Generate a secret with (do not commit or share the output):

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm start
```

- Public site: `http://localhost:3000` (bilingual, searchable, paginated directory with recent/popular sorting and server-injected SEO, Open Graph and JSON-LD metadata; visit counts track successful public entry HTML requests only—ignoring static assets, `HEAD` requests, private shares and previews—in the `public_page_visits` table of `data/hostlet.sqlite`)
- Workspace: `http://localhost:3000/workspace` (account workspace in multiuser mode, page manager in single-admin mode)
- Page-management console: `http://localhost:3000/console`
- Platform administration: `http://localhost:3000/platform-admin` (multiuser hosting only)
- Hosted pages (single-admin / local default): `http://localhost:8080/p/<slug>/`
- GitHub source link: `PUBLIC_GITHUB_URL` and `PUBLIC_GITHUB_LABEL` (defaults to this repository; set empty to hide)
- Development: `npm run dev`, then `http://localhost:5173`
- Verification: `npm test`, `npm run build` or `npm run check`

## Publish

The platform interface supports Simplified Chinese and English. It initially follows the browser language; the language switch on the login screen and management header remembers your choice. Platform-owned private-access and not-found screens also support both languages. Uploaded HTML content is never translated or branded by the platform.

In single-admin mode, sign in with the configured `ADMIN_PASSWORD`, choose Upload page, upload an HTML file or ZIP, set its title, mount slug, HTML entry file and public/private access, then publish.

ZIP archives may contain the entry at their root or within one enclosing folder. Use relative asset URLs such as `assets/style.css`, and relative links between pages. Root-relative URLs such as `/assets/style.css` do not point inside a mounted site. This hosts static files; it does not execute server-side code or provide SPA fallback routing.

Page settings support editing, replacement releases, version history, rollback, previews, copying links and deletion. Replacing a release preserves the mount path. Changing its slug breaks the previous URL. Preview links expire after 15 minutes; changing the active release invalidates its previous grants, including if an earlier version is restored. Stored versions count towards the storage statistic. Single-admin legacy pages do not automatically prune history; monitor disk usage. Workspace applications are capped at 20 retained versions and provide explicit old-version deletion.

## CLI

The CLI is published on npm as [`hostlet-cli`](https://www.npmjs.com/package/hostlet-cli) and requires Node.js 22.13 or later. Its source lives in [`cli/`](cli).

```sh
npm install -g hostlet-cli
hostlet --help
```

For development, install from this checkout, build a local tarball, or run from source:

```sh
npm install -g ./cli
npm pack ./cli
npm install -g ./hostlet-cli-0.2.3.tgz
```

Running from source remains supported with `node cli/hostlet.js ...` (or `npm run pack:cli` to build the tarball).

Register or sign in, create an API key, publish and manage applications without visiting the portal first:

```sh
hostlet register --username alice --password-stdin
hostlet workspaces
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo"
hostlet visibility public --workspace WORKSPACE_ID --page PAGE_ID
hostlet rename --workspace WORKSPACE_ID --page PAGE_ID --title "New title"
hostlet delete-release --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet delete-app --workspace WORKSPACE_ID --page PAGE_ID --confirm
```

The account password is read from standard input and must contain at least 12 characters. `register` and `login` save the account session and a 30-day API key with `read`, `publish` and `share` scopes (use `--no-key` to save only the session); later commands read the saved token automatically. `HOSTLET_URL` is optional and defaults to `https://hostlet.cn`; set it for a custom instance. `HOSTLET_TOKEN` remains supported for automation and overrides the saved token (`HOSTLET_CONFIG` overrides the credentials file path). The target instance must expose the account credential flow and `/api/cli`. Do not use the administrator password as a token, and do not commit the token or write it to logs.

The official `hostlet.cn` deployment exposes username registration and account API credentials, so it can be used directly for CLI and Skill publishing. Username accounts cannot recover passwords by email yet; keep the password safe.

Full command examples:

```sh
hostlet register --username alice --password-stdin
hostlet login --identifier alice --password-stdin
hostlet whoami
hostlet logout
hostlet keys list
hostlet keys create --key-name "CI publisher" --password-stdin
hostlet keys revoke --id KEY_ID
hostlet workspaces
hostlet pages --workspace WORKSPACE_ID
hostlet versions --workspace WORKSPACE_ID --page PAGE_ID
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo" --json
hostlet publish-status --workspace WORKSPACE_ID --request-id REQUEST_ID --json
hostlet rollback --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet visibility public --workspace WORKSPACE_ID --page PAGE_ID
hostlet rename --workspace WORKSPACE_ID --page PAGE_ID --title "New title"
hostlet delete-release --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet delete-app --workspace WORKSPACE_ID --page PAGE_ID --confirm
hostlet shares --workspace WORKSPACE_ID --page PAGE_ID
hostlet share --workspace WORKSPACE_ID --page PAGE_ID --expires 2027-01-01T00:00:00Z --password-stdin
hostlet revoke-share --workspace WORKSPACE_ID --page PAGE_ID --share SHARE_ID
```

`hostlet --help` lists every command. `hostlet help <command>` or `hostlet <command> --help` shows command options, and `hostlet --version` prints the package version. Help and version work without credentials. See [`cli/README.md`](cli/README.md) for installation, credential scopes, JSON output and recovery details.

### Publishing, Management and Idempotent Recovery

- **Publish and replace:** `publish` accepts an HTML file, a ZIP archive, or a directory and creates a private application by default (`--entry` selects the HTML entry inside a ZIP or directory). To replace an existing application, pass `--page PAGE_ID --revision REVISION` (`--title` is ignored during replacement; use `rename` to change the title). Successful output returns `managementUrl` and, when the instance exposes a hosting address, `applicationUrl` (private links require sign-in; publishing never makes an app public automatically). Directories must not contain hidden files, `node_modules`, or symlinks. Only HTTPS is accepted for remote instances; HTTP is limited to loopback testing. Tokens can be revoked from the account portal or with `keys revoke`, and changing the password revokes existing tokens.
- **Rollback, delete and team review:** `rollback` and `delete-release` require the current `--revision`; a `CONFLICT` response means the application changed and must be refreshed. The active release cannot be deleted until another release is activated. `delete-app` permanently removes the application, all releases and its public address, requires `--confirm`, and is restricted to personal workspaces or team owners. Team editors can submit a private app for owner approval; owners can approve, reject, or publish directly. Review is tied to the submitted release, and a public team app must be set back to private before replacing or rolling back its release.
- **Shares:** Listing, creating or revoking shares requires the `share` scope. `shares` lists metadata only; a newly created `share` link is printed once and cannot be recovered; `revoke-share` revokes access immediately. Share passwords can be supplied through `--password-stdin` or `HOSTLET_SHARE_PASSWORD`, and `--expires` accepts a future ISO-8601 time. After a network error or 5xx response during `share`, run `shares` before retrying.
- **Idempotency and unconfirmed results:** The CLI prints the request ID to standard error before uploading (even with `--json`), sends the file SHA-256 and byte length, and packs directories deterministically so identical content produces identical bytes. `--request-id REQUEST_ID` accepts 22–128 letters, digits, `_` or `-`. Before uploading, the CLI queries the status endpoint with the same request ID and aborts unless valid JSON status is returned. After an unconfirmed response or network failure, run `publish-status`: `succeeded` means the historical request committed (check current app state); `in_progress` means check again later; `interrupted` or `not_found` does not prove the request missed, so retry with the **exact same request ID, file, filename, title, entry, target page and revision** (use a new request ID if anything changes). Success receipts do not auto-expire yet and are cleared when the account or workspace is deleted; API rate limits are per-process and public deployments still need edge rate limiting.

## Agent Skill

The publishing skill is published on npm as [`hostlet-skill`](https://www.npmjs.com/package/hostlet-skill) and its source lives in [`skills/hostlet-publish/`](skills/hostlet-publish/).

```sh
npx --yes hostlet-skill@latest install
```

The public homepage provides a copyable version of this command and an AI-assistant setup prompt (which stops once setup is verified without triggering account auth or publishing early). The installer copies the skill into `$CODEX_HOME/skills/hostlet-publish` by default and bundles an isolated CLI at `bin/hostlet` (Windows: prefer `bin/hostlet.ps1`; `bin/hostlet.cmd` is kept for compatibility but splits arguments that contain spaces), so no global CLI install is required. Use `--target` for another skills directory; `--skip-cli` is available only when a global `hostlet` already exists or the environment is offline.

The CLI bundled with each skill release is pinned for reproducible installs. To follow the newest published CLI explicitly, run:

```sh
npx --yes hostlet-skill@latest install --cli-version latest
```

The skill defaults to the official `https://hostlet.cn` instance and switches to a self-hosted instance through `HOSTLET_URL`. It requires confirmation before registering an account, creating a key, or publishing (including the instance, workspace name and ID, source, title, entry, new/replace mode with page ID/revision, and access state). It keeps new applications private by default, never accepts or prints secrets, returns clickable `applicationUrl` or `managementUrl` links after a successful publish (noting sign-in for private apps), and checks `publish-status` on uncertain requests before retrying.

### Releasing CLI and Skill packages

Bump `cli/package.json` or `skills/hostlet-publish/package.json` and push a matching tag (`hostlet-cli-v*` or `hostlet-skill-v*`). `.github/workflows/publish-cli.yml` and `.github/workflows/publish-skill.yml` validate the tag against the manifest and publish through npm Trusted Publishing (OIDC), so no long-lived npm token or one-time password is stored in the repository:

```sh
git tag -a hostlet-cli-v0.2.3 -m "hostlet-cli 0.2.3"
git push origin hostlet-cli-v0.2.3

git tag -a hostlet-skill-v0.2.6 -m "hostlet-skill 0.2.6"
git push origin hostlet-skill-v0.2.6
```

## Multiuser mode

Multiuser features are disabled by default. Set `MULTIUSER_ENABLED=true` and `REGISTRATION_ENABLED=true` to enable account registration (platform settings can also toggle registration later).

- **Registration modes:** Email registration requires SMTP with TLS or STARTTLS. Username accounts can be enabled with `USERNAME_REGISTRATION_ENABLED=true`; they sign in immediately without email verification, accept 3–32 lowercase letters, digits, underscores or hyphens, and cannot recover passwords by email.
- **Domains and isolation:** Set `ADMIN_ORIGIN` to the exact externally visible management origin and `COOKIE_SECURE=true` for HTTPS. Workspace hosting requires `APPS_DOMAIN` and wildcard DNS/HTTPS routed to the pages service with the original `Host` header. Using a separate registrable domain for the management service provides the strongest isolation. For a demo deployment with one registrable domain, set `SINGLE_DOMAIN_HOSTING=true` and point `APPS_DOMAIN` at a subdomain such as `apps.hostlet.cn`; functionality is retained, but isolation drops from cross-site to same-site cross-origin, with `__Host-` cookies and strict Origin checks enforced. See [single-IP deployment](docs/single-ip-deployment.md) for the controlled single-IP trial setup.
- **Accounts, workspaces and retention:** User accounts and workspaces are separate from the legacy single-admin account and its pages; existing pages are not automatically assigned to a user (see [legacy migration](docs/legacy-migration.md) for the explicit offline migration workflow). Applications default to private; editors can make them public or create revocable, optionally password-protected share links. Workspace quotas and administrative suspension are available. Each application retains up to 20 versions including the current version; interrupted version deletion is retried at startup and pending files remain charged against quota. Administrators can select long-term retention (default) or inactivity cleanup with advance email notification; see [retention](docs/retention.md). Verified account holders can delete their account after confirming their current password (personal apps are removed, team apps remain with the team, the last team owner must transfer ownership first, sessions are revoked, and interrupted deletion resumes at startup before serving requests).
- **Workspace hosting behavior:** For workspace ZIP uploads, leave the entry path blank to auto-detect a single HTML entry; if multiple entries exist, select one (up to 200 candidates and 64 KiB of candidate paths are offered; larger sets require an explicit path). Workspace apps have their own origin root; a subdirectory containing `index.html` opens at its trailing-slash URL, and SPA fallback routing is not provided. Applications run in visitors' browsers, so never include private keys or secrets in uploaded files.
- **Legacy single-admin private pages:** Legacy private pages share `ADMIN_PASSWORD` with administrator login (sharing that password also grants admin access). Private resource URLs contain signed bearer grants valid for 7 days after page login. Uploaded pages run inside a CSP sandbox without `allow-same-origin`, so browser storage and some origin-dependent scripts are unavailable.

## Storage and limits

- **Data and backups:** SQLite metadata, sessions and audit records live in `data/hostlet.sqlite`, and published files live under `data/storage/sites/<id>/releases/`. Back up the whole `data/` directory and `.env` together while the service is stopped, and keep the same absolute storage location when restoring because release paths are recorded in SQLite.
- **Security logs:** Sanitized HTTP security events are written under `data/security-logs/` by default, with UTC daily rotation and a 180-day default retention (`SECURITY_LOG_RETENTION_DAYS`). These files never include request bodies, cookies, query strings, passwords or token-bearing URLs. Review [security logging](docs/security-logging.md) before public operation.
- **Upload and archive limits:** Default upload size is 50 MiB (`MAX_UPLOAD_BYTES`). ZIP limits: 4,000 entries including folders, 2,000 files, 25 MiB per extracted file and 100 MiB total extracted content. ZIP64 is not supported; archives must contain the configured entry, and unsafe paths are rejected.

## Deployment

- Non-Docker Ubuntu host deployment (systemd + Nginx): [host deployment](docs/host-deployment.md).
- Single-host container example, recovery boundaries and verification notes: [deployment](docs/deployment.md).
- Controlled single-IP deployment trial: [single-IP deployment](docs/single-ip-deployment.md).

Production deployment checklist:

- Use separate HTTPS hostnames for administration and uploaded content, preferably on separate registrable domains. Route the admin hostname to port `3000` and the content hostname to port `8080`, and never expose the admin API on the content hostname.
- Set `PUBLIC_BASE_URL`, `ADMIN_ORIGIN` and `ADMIN_ORIGINS` to the actual external origins, and set `COOKIE_SECURE=true` under HTTPS.
- Preserve the hosted content's CSP and MIME headers, keep grant URLs out of proxy access logs, and disable shared caching for private content.
- By default, forwarded client headers are not trusted; behind a reverse proxy, set `TRUSTED_PROXY_IPS` to the proxy's specific IPs or CIDRs and block direct external access to backend ports.
- Run only a single application instance (the standard entrypoint acquires `data/.hostlet-instance-lock` to prevent concurrent writes to SQLite and storage). `.env`, `data/` and generated build output are excluded from version control.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately via GitHub security advisories according to [SECURITY.md](SECURITY.md); do not disclose them in public issues.
