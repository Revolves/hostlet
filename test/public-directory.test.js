import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../server/database.js";
import {
  publicDirectorySchema,
  createPublicDirectoryService,
} from "../server/public-directory.js";
import { latestDatabaseVersion } from "../server/migrations.js";

function fixtures() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  openDatabase(":memory:").close();
  db.exec(`
    CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL, access_mode TEXT NOT NULL, source_type TEXT NOT NULL, file_count INTEGER NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL);
    CREATE TABLE workspace_pages (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, source_type TEXT NOT NULL, file_count INTEGER NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE workspace_page_visibility (page_id TEXT PRIMARY KEY);
    CREATE TABLE platform_page_suspensions (page_id TEXT PRIMARY KEY);
  `);
  db.exec(publicDirectorySchema);
  return db;
}

function seed(db) {
  db.exec(`
    INSERT INTO pages VALUES
      ('page-open', 'Atlas field notes', 'atlas', 'public', 'html', 1, 2048, '2026-01-02T00:00:00.000Z', '2026-02-03T00:00:00.000Z'),
      ('page-closed', 'Internal review', 'internal', 'private', 'html', 1, 2048, '2026-01-01T00:00:00.000Z', '2026-03-04T00:00:00.000Z');
    INSERT INTO users VALUES ('owner', 'lin@example.org');
    INSERT INTO workspaces VALUES ('team', 'Field studio', 'team'), ('personal', 'Lin', 'personal');
    INSERT INTO workspace_pages VALUES
      ('w-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'team', 'Signal archive', 'zip', 12, 4096, '2026-01-04T00:00:00.000Z', '2026-02-05T00:00:00.000Z'),
      ('w-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'personal', 'Quiet maps', 'html', 1, 1024, '2026-01-05T00:00:00.000Z', '2026-02-06T00:00:00.000Z'),
      ('w-cccccccccccccccccccccccccccccccc', 'team', 'Draft room', 'html', 1, 1024, '2026-01-06T00:00:00.000Z', '2026-03-07T00:00:00.000Z'),
      ('w-dddddddddddddddddddddddddddddddd', 'team', 'Paused exhibit', 'html', 1, 1024, '2026-01-07T00:00:00.000Z', '2026-03-08T00:00:00.000Z');
    INSERT INTO workspace_page_visibility VALUES
      ('w-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ('w-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      ('w-dddddddddddddddddddddddddddddddd');
    INSERT INTO platform_page_suspensions VALUES ('w-dddddddddddddddddddddddddddddddd');
  `);
}

test("migration installs the public directory counters", () => {
  const db = openDatabase(":memory:");
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, latestDatabaseVersion);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='public_page_visits'").get());
  assert.equal(db.prepare("SELECT count(*) n FROM public_page_visits").get().n, 0);
  db.close();
});

test("directory lists only public, unsuspended applications with stable access totals", (t) => {
  const db = fixtures();
  t.after(() => db.close());
  seed(db);
  const service = createPublicDirectoryService({
    db,
    legacyUrl: (slug) => `https://pages.example.test/p/${slug}/`,
    workspaceUrl: (id) => `https://${id}.apps.example.test/`,
  });

  service.recordVisit({ kind: "legacy", pageId: "page-open" });
  service.recordVisit({ kind: "legacy", pageId: "page-open" });
  service.recordVisit({ kind: "workspace", pageId: "w-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  service.recordVisit({ kind: "workspace", pageId: "w-cccccccccccccccccccccccccccccccc" });

  const { apps, stats } = service.list();
  assert.deepEqual(apps.map((app) => app.id), [
    "w-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "w-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "page-open",
  ]);
  assert.deepEqual(apps.map((app) => app.visits), [0, 1, 2]);
  assert.equal(apps[1].workspaceName, "Field studio");
  assert.equal(apps[1].workspaceType, "team");
  assert.equal(apps[1].url, "https://w-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps.example.test/");
  assert.equal(apps[2].url, "https://pages.example.test/p/atlas/");
  assert.deepEqual(stats, { applications: 3, workspaces: 2, visits: 3 });
});

test("recordVisit accepts entry document requests exactly once", (t) => {
  const db = fixtures();
  t.after(() => db.close());
  seed(db);
  const service = createPublicDirectoryService({ db, legacyUrl: () => "", workspaceUrl: () => "" });

  assert.equal(service.recordVisit({ kind: "legacy", pageId: "page-open", method: "GET", entryDocument: true }), true);
  assert.equal(service.recordVisit({ kind: "legacy", pageId: "page-open", method: "GET", entryDocument: true }), true);
  assert.equal(service.recordVisit({ kind: "legacy", pageId: "page-open", method: "HEAD", entryDocument: true }), false);
  assert.equal(service.recordVisit({ kind: "legacy", pageId: "page-open", method: "GET", entryDocument: false }), false);
  assert.equal(service.recordVisit({ kind: "legacy", pageId: "page-closed", method: "GET", entryDocument: true }), false);
  assert.equal(service.recordVisit({ kind: "workspace", pageId: "w-dddddddddddddddddddddddddddddddd", method: "GET", entryDocument: true }), false);
  assert.equal(db.prepare("SELECT count(*) n FROM public_page_visits").get().n, 1);
  assert.equal(db.prepare("SELECT visits FROM public_page_visits WHERE page_key='legacy:page-open'").get().visits, 2);
});
