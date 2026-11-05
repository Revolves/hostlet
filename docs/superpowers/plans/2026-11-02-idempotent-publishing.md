# Idempotent Publishing Implementation Plan

> **For agentic workers:** Use subagent-driven-development and test-first implementation.

**Goal:** Make CLI publication safely retryable and queryable after uncertain network results.

**Architecture:** A SQLite-backed receipt keyed by actor, workspace and request ID is claimed before upload, then receives a full request fingerprint after upload. Successful receipt and publication commit atomically in the existing quota transaction. Startup recovery marks unresolved claims interrupted only after publication recovery, under the existing single-instance lock. The CLI produces deterministic ZIP bytes and uses explicit request headers.

**Tech Stack:** Node 22, SQLite, Express/multer, JSZip, node:test.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-11-02-idempotent-publishing-design.md`; old clients without headers remain compatible.
- Headers: `Idempotency-Key` is 22–128 ASCII alphanumeric, underscore or hyphen; `X-Content-SHA256` is 64 lowercase hexadecimal; `X-Content-Length` is canonical nonnegative decimal. All three must be present exactly once together.
- CLI query route: `GET /api/cli/workspaces/:workspaceId/publications/:requestId`; response `{status: 'not_found'|'in_progress'|'interrupted'|'succeeded', result?}`.
- Header digest must be recomputed over uploaded bytes, filename and metadata must bind to a stable fingerprint, and authorization must be rechecked on query, replay and commit.
- Completed receipt and page/version must commit in the same SQLite transaction; do not touch existing deployment/data; tests use temporary data.
- Do not commit: repository has no baseline commit and user has not requested one.

### Task 1: Durable receipt and recovery

**Files:** new `server/publication-idempotency.js`, new tests, `server/migrations.js`.

- [ ] TDD schema, atomic claim, conflict and replay, payload binding, success inside caller transaction, failure and startup recovery; include owner/workspace isolation and retention semantics.
- [ ] Versioned migration, no secrets or raw user file bytes in receipts.

### Task 2: API and transaction integration

**Files:** `server/workspace-pages.js`, `server/workspace-pages-router.js`, `server/app.js`, `server/ip-management-guard.js`, tests.

- [ ] Claim before upload; calculate real SHA-256, bind validated metadata, check replay/conflicts and release reservations; commit receipt with actual publication in quota transaction.
- [ ] Query route with current authorization; after startup recovery mark incomplete claims interrupted; support single-IP guard and CLI bearer scoping.
- [ ] Test concurrent requests, all crash windows, token/member revocation, quota and logs.

### Task 3: CLI and documentation

**Files:** `cli/hostlet.js`, CLI tests, README documentation.

- [ ] Implement deterministic directory ZIP, request ID generation/override, content hash and length headers; print ID before network attempt without token.
- [ ] Add status query and clear unknown-result instructions; preserve JSON output and update docs.

### Task 4: Full verification

- [ ] Exercise temporary database and HTTP integration including retries, restarts, rate/permission failures and single-IP mode.
- [ ] Run full test suite, build, focused browser/CLI checks as appropriate; independent security review. Report limitations accurately.
