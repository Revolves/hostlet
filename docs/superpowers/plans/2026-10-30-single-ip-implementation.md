# Single-IP Trusted Deployment Implementation Plan

> **For agentic workers:** Use subagent-driven-development; track each independently verifiable task below.

**Goal:** Support explicitly enabled single-IP deployment for trusted users with separate management and content ports.

**Architecture:** Preserve existing domain hosting unchanged. Add a separately gated IP mode using route-based content, closed registration, and per-resource authorization; enforce management boundaries independently of cross-port cookies. Treat all hosted pages as mutually trusted and disclose shared origin storage.

**Tech Stack:** Node 22, Express, SQLite, React, Docker, independent Chrome browser tests.

## Global Constraints

- Refer to `docs/superpowers/specs/2026-10-30-single-ip-hosting-design.md`; no claim of cross-page isolation.
- Registration must remain closed in IP mode even if persisted settings or API request attempt to enable it.
- HTTPS with IP-matching certificate; no automated assumptions about ports 80/443.
- Never modify existing server containers, other directories, or actual user data; no commits without user request.
- Each behavior change starts with a failing focused test, then implementation and rerun.

### Task 1: threat model and enforcement

**Files:** `server/app.js`, `server/config.js`, account/platform routers and their tests.

- [ ] Audit all management reads, writes, cookie behavior and registration override paths for same-host different-port threats.
- [ ] Add an offline, administrator-controlled account provisioning path with email verification, exclusive data-directory lock and tests; closed registration must not make fresh deployments unusable.
- [ ] Write regression tests demonstrating intended rejection of content-origin mutations, cookie collisions and registration reopening.
- [ ] Implement fail-closed configuration and request boundaries; run focused tests and independent security review.

### Task 2: IP content routing

**Files:** `server/workspace-hosting.js`, new focused module if needed, relevant server tests.

- [ ] Test exact IP and port validation, path parsing, HTML and static-resource authorization, member removal, suspension and share revocation.
- [ ] Implement isolated IP mode without weakening existing domain mode. Ensure all resources resolve under the selected page and worker registration is forbidden.
- [ ] Test ticket transfer, cookie handling, traversal and invalid host cases against HTTP integration fixture.

### Task 3: client experience and branding

**Files:** `admin/src/App.jsx`, `admin/src/components/AccountPortal.jsx`, `ShareVisitor.jsx`, `ReportPage.jsx`, relevant documentation.

- [ ] Test and implement IP URLs, share and ticket exchange; clearly label shared browser storage and path-prefix requirements.
- [ ] Add agreed brand message without claiming unimplemented migration functionality.

### Task 4: safe deployment and validation

**Files:** dedicated `deploy` configuration and `docs/deployment.md`, isolated test scripts.

- [ ] Provide independent IP-mode Compose configuration, IP certificate configuration and explicit trusted-team boundary.
- [ ] Run full unit/integration tests and build; run isolated HTTPS browser tests for two pages, sharing, revocation, browser storage, malicious content against management, and restart persistence.
- [ ] Only after those checks pass, use the authorized server directory and ports 30006/30007; inspect existing state before starting and do not alter other services.
- [ ] Report actual test coverage, TLS trust limitation and any remaining deployment blockers.
